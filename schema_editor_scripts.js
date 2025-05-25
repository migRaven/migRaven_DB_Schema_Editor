let schemaData = null;
        let currentNode = null;
        let isModified = false;
        let neo4jDriver = null;
        let lastCypherQueryForExport = ''; 
        let dbSchemaInfo = null; // To store version/timestamp from DB
        let localSchemaFilePath = null; // To store the path/name of the loaded JSON file for re-saving
        const GLOBAL_SCHEMA_META_ID = 'migRaven_Schema'; // Added constant

        // Neo4j Connection Configuration
        const neo4jConfig = {
            url: '',
            username: '',
            password: '',
            database: '', // Added database field
            connected: false
        };

        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('fileInput').addEventListener('change', handleFileLoad);
            document.getElementById('searchBox').addEventListener('input', filterNodes);
            // Add other event listeners that depend on DOM being loaded here if any
        });

        function updateModifiedStatus(modified) {
            isModified = modified;
            document.getElementById('modifiedIndicator').style.display = modified ? 'inline' : 'none';
            if (modified && schemaData) {
                schemaData.timestamp = new Date().toISOString();
                // Version is incremented upon explicit save actions (download or save to DB)
                updateSchemaInfoDisplay(
                    document.getElementById('schemaSource').textContent || 'JSON File',
                    schemaData.version,
                    schemaData.timestamp
                );
            }
            // Enable/disable save buttons based on modification status and schema presence
            const hasSchema = !!schemaData;
            document.getElementById('downloadBtn').disabled = !hasSchema;
            document.getElementById('cypherBtn').disabled = !hasSchema;
            document.getElementById('saveToDbBtn').disabled = !hasSchema || !isModified;
            document.getElementById('loadFromDbBtn').disabled = !neo4jConfig.connected; // Disable if not connected
            document.getElementById('generateSchemaBtn').disabled = !neo4jConfig.connected; // Disable if not connected
        }

        function toggleNeo4jConfig() {
            const detailsDiv = document.getElementById('neo4jConfigDetails');
            const indicator = document.getElementById('configToggleIndicator');
            const section = document.getElementById('neo4jConfigSection');
            const testConnectionBtn = document.getElementById('testConnectionBtn');

            if (detailsDiv.style.display === 'none') {
                detailsDiv.style.display = 'block';
                indicator.textContent = '(-)';
                section.classList.remove('minimized');
                testConnectionBtn.style.display = 'inline-block'; // Show button when expanded
            } else {
                detailsDiv.style.display = 'none';
                indicator.textContent = '(+)';
                section.classList.add('minimized');
                testConnectionBtn.style.display = 'none'; // Hide button when minimized
            }
        }

        // ===== NEO4J CONNECTION =====
        
        async function testConnection() {
            const urlInput = document.getElementById('neo4jUrl').value;
            const userInput = document.getElementById('neo4jUser').value;
            const passwordInput = document.getElementById('neo4jPassword').value;
            const databaseInput = document.getElementById('neo4jDatabase').value.trim(); // Get database name
            
            const statusDiv = document.getElementById('connectionStatus');
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<div class="connection-warning">🔄 Testing connection...</div>`;
            
            if (neo4jDriver) {
                try {
                    await neo4jDriver.close();
                } catch (e) {
                    console.warn("Error closing existing Neo4j driver:", e);
                }
                neo4jDriver = null;
            }

            try {
                neo4jDriver = neo4j.driver(urlInput, neo4j.auth.basic(userInput, passwordInput));
                // Pass database to verifyConnectivity. If empty, driver uses default.
                const verificationConfig = {};
                if (databaseInput) {
                    verificationConfig.database = databaseInput;
                }
                await neo4jDriver.verifyConnectivity(verificationConfig);
                
                neo4jConfig.url = urlInput;
                neo4jConfig.username = userInput;
                neo4jConfig.password = passwordInput; 
                neo4jConfig.database = databaseInput; // Store database name
                neo4jConfig.connected = true;
                
                statusDiv.innerHTML = `<div class="connection-success">✅ Connection successful! (DB: ${databaseInput || 'default'})</div>`;
                if(schemaData) document.getElementById('compareBtn').disabled = false;
                document.getElementById('loadFromDbBtn').disabled = false; // Enable load from DB button
                document.getElementById('generateSchemaBtn').disabled = false; // Enable generate schema button

                // Minimize config section on successful connection
                const configDetails = document.getElementById('neo4jConfigDetails');
                if (configDetails.style.display !== 'none') {
                    toggleNeo4jConfig();
                }

            } catch (error) {
                neo4jConfig.connected = false;
                neo4jDriver = null;
                statusDiv.innerHTML = `<div class="connection-error">❌ Connection failed: ${error.message}</div>`;
                document.getElementById('compareBtn').disabled = true;
                document.getElementById('loadFromDbBtn').disabled = true; // Disable on connection error
                document.getElementById('generateSchemaBtn').disabled = true; // Disable on connection error
            }
        }
        
        // ===== LOAD EXAMPLE VALUES =====
        
        async function loadNodeExamples(nodeLabel) {
            const limit = document.getElementById('nodeExampleLimit').value || 10;
            const container = document.getElementById(`nodeExamples-${nodeLabel}`);
            
            if (!neo4jConfig.connected || !neo4jDriver) {
                showConnectionWarning(container, "Load Node Examples");
                return;
            }
            
            container.style.display = 'block';
            container.innerHTML = `<div class="loading-spinner"></div> Loading example nodes...`;
            
            try {
                const examples = await executeNeo4jQuery(`
                    MATCH (n:${nodeLabel})
                    RETURN n
                    LIMIT ${limit}
                `); 
                
                displayNodeExamples(container, examples, nodeLabel);
            } catch (error) {
                container.innerHTML = `<div class="connection-error">❌ Error loading: ${error.message}</div>`;
            }
        }
        
        async function loadAttributeExamples(nodeLabel, attributeName) {
            const container = document.getElementById(`examples-${nodeLabel}-${attributeName}`);
            
            if (!neo4jConfig.connected || !neo4jDriver) {
                showConnectionWarning(container, "Load Attribute Examples");
                return;
            }
            
            container.innerHTML = `<div class="loading-spinner"></div> Loading...`;
            
            try {
                const examples = await executeNeo4jQuery(`
                    MATCH (n:${nodeLabel})
                    WHERE n.${attributeName} IS NOT NULL
                    RETURN DISTINCT n.${attributeName} as value
                    LIMIT 10
                `);
                
                displayAttributeExamples(container, examples);
            } catch (error) {
                container.innerHTML = `<span class="example-tag" style="background: #f8d7da; color: #721c24;">❌ Error: ${error.message}</span>`;
            }
        }
        
        async function loadRelationshipExamples(sourceLabel, relationshipName, targetLabel) {
            const container = document.getElementById(`rel-examples-${sourceLabel}-${relationshipName}`);
            
            if (!neo4jConfig.connected || !neo4jDriver) {
                showConnectionWarning(container, "Load Relationship Examples");
                return;
            }
            
            container.innerHTML = `<div class="loading-spinner"></div> Loading...`;
            
            try {
                const query = targetLabel && targetLabel !== 'null' ? 
                    `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b:${targetLabel})
                     RETURN a.name as source_name, type(r) as rel_type, b.name as target_name
                     LIMIT 10` :
                    `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b)
                     RETURN a.name as source_name, type(r) as rel_type, labels(b)[0] as target_label
                     LIMIT 10`;
                
                const examples = await executeNeo4jQuery(query);
                displayRelationshipExamples(container, examples);
            } catch (error) {
                container.innerHTML = `<span class="example-tag" style="background: #f8d7da; color: #721c24;">❌ Error: ${error.message}</span>`;
            }
        }

        // ===== NEO4J QUERY EXECUTION =====
        
        async function executeNeo4jQuery(query, params = {}) {
            if (!neo4jConfig.connected || !neo4jDriver) {
                throw new Error("Not connected to Neo4j. Please test connection first.");
            }

            const sessionConfig = {};
            if (neo4jConfig.database) {
                sessionConfig.database = neo4jConfig.database;
            }
            const session = neo4jDriver.session(sessionConfig);
            try {
                const result = await session.run(query, params);
                return result.records.map(record => {
                    const obj = {};
                    record.keys.forEach(key => {
                        let value = record.get(key);
                        if (neo4j.isInt(value)) {
                            value = value.toNumber(); 
                        } else if (typeof value === 'object' && value !== null && value.properties) {
                            value = value.properties;
                        }
                        obj[key] = value;
                    });
                    return obj;
                });
            } catch (error) {
                console.error("Neo4j Query Error:", error, "Query:", query, "Params:", params);
                throw error; 
            } finally {
                await session.close();
            }
        }
        
        // ===== DISPLAY EXAMPLE VALUES =====
        
        function displayNodeExamples(container, examples, nodeLabel) {
            if (!examples || examples.length === 0) {
                container.innerHTML = `<div class="no-examples">No example nodes found for ${nodeLabel}</div>`;
                return;
            }
            
            let html = '';
            examples.forEach((record, index) => {
                const nodeProperties = record.n || record; 
                const properties = Object.entries(nodeProperties)
                    .slice(0, 5) 
                    .map(([key, value]) => `<span class="example-key">${key}:</span> <span class="example-value">${truncateValue(value)}</span>`)
                    .join('<br>');
                
                html += `
                    <div class="example-item">
                        <strong>Node ${index + 1}:</strong><br>
                        ${properties}
                        ${Object.keys(nodeProperties).length > 5 ? '<br><em>... and more properties</em>' : ''}
                    </div>
                `;
            });
            
            container.innerHTML = html;
        }
        
        function displayAttributeExamples(container, examples) {
            if (!examples || examples.length === 0) {
                container.innerHTML = `<span class="no-examples">No example values found</span>`;
                return;
            }
            
            const uniqueValues = [...new Set(examples.map(e => e.value))].slice(0, 10);
            const tags = uniqueValues.map(value => 
                `<span class="example-tag">${truncateValue(value)}</span>`
            ).join('');
            
            container.innerHTML = tags;
        }
        
        function displayRelationshipExamples(container, examples) {
            if (!examples || examples.length === 0) {
                container.innerHTML = `<span class="no-examples">No example relationships found</span>`;
                return;
            }
            
            const tags = examples.map(rel => 
                `<span class="example-tag">${rel.source_name || 'N/A'} → ${rel.target_name || rel.target_label || 'N/A'}</span>`
            ).join('');
            
            container.innerHTML = tags;
        }
        
        function showConnectionWarning(container, action = "This action") {
            container.innerHTML = `<div class="connection-warning">⚠️ No Neo4j connection. Please test connection first before attempting: ${action}.</div>`;
            if (container.style) container.style.display = 'block'; 
        }
        
        function truncateValue(value, maxLength = 50) {
            const str = String(value);
            return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
        }

        function handleFileLoad(event) {
            const file = event.target.files[0];
            if (!file) return;
            localSchemaFilePath = file.name; 

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    let loadedData = JSON.parse(e.target.result);
                    
                    if (typeof loadedData.version !== 'number') {
                        loadedData.version = 1;
                        isModified = true; 
                    }
                    if (typeof loadedData.timestamp !== 'string') {
                        loadedData.timestamp = new Date().toISOString();
                        isModified = true; 
                    }

                    schemaData = loadedData;
                    dbSchemaInfo = null; 

                    renderTreeView();
                    updateStats();
                    updateSchemaInfoDisplay("JSON File", schemaData.version, schemaData.timestamp);

                    document.getElementById('downloadBtn').disabled = false;
                    document.getElementById('cypherBtn').disabled = false;
                    document.getElementById('saveToDbBtn').disabled = true; 
                    if (neo4jConfig.connected) {
                        document.getElementById('compareBtn').disabled = false;
                    }
                    document.getElementById('statsBar').style.display = 'flex';
                    document.getElementById('comparisonResults').style.display = 'none';
                    document.getElementById('comparisonText').textContent = 'No comparison performed yet.';
                    updateModifiedStatus(isModified); 

                } catch (error) {
                    alert('Error loading JSON file: ' + error.message);
                }
            };
            reader.readAsText(file);
        }

        function updateSchemaInfoDisplay(source, version, timestamp, suffix = '') {
            document.getElementById('currentSchemaInfo').style.display = 'block';
            document.getElementById('schemaSource').textContent = source + suffix;
            document.getElementById('schemaVersion').textContent = version !== undefined ? version : 'N/A';
            document.getElementById('schemaTimestamp').textContent = timestamp || 'N/A';
        }

        function renderTreeView() {
            const container = document.getElementById('treeContainer');
            container.innerHTML = '';

            if (!schemaData || !schemaData.node_types) {
                 container.innerHTML = `<div class="no-selection"><p>No node types found in schema or schema not loaded.</p></div>`;
                return;
            }
            if (schemaData.node_types.length === 0) {
                container.innerHTML = `<div class="no-selection"><p>Schema loaded, but it contains no node types.</p></div>`;
                return;
            }

            schemaData.node_types.forEach((node, index) => {
                const nodeElement = createNodeElement(node, index);
                container.appendChild(nodeElement);
            });
        }

        function createNodeElement(node, index) {
            const div = document.createElement('div');
            div.className = 'node-item';
            
            const attrCount = Object.keys(node.attributes || {}).length;
            const relCount = Object.keys(node.relationships || {}).length;
            
            div.innerHTML = `
                <div class="node-header" onclick="selectNode(${index})">
                    <div class="node-label">${node.label}</div>
                    <div class="node-stats">${attrCount} Attr. • ${relCount} Rel.</div>
                </div>
            `;
            
            return div;
        }

        function selectNode(index) {
            currentNode = index;
            
            document.querySelectorAll('.node-header').forEach(h => h.classList.remove('active'));
            document.querySelectorAll('.node-header')[index].classList.add('active');
            
            renderNodeDetails(schemaData.node_types[index]);
            // Default to showing Node Properties tab
            if (document.getElementById('tabButtonNodeProperties')) {
                openTab(null, 'NodeProperties');
            }
        }

        function openTab(event, tabName) {
            // Get all elements with class="tab-content" and hide them
            const tabcontent = document.getElementsByClassName("tab-content");
            for (let i = 0; i < tabcontent.length; i++) {
                tabcontent[i].style.display = "none";
                tabcontent[i].classList.remove("active");
            }

            // Get all elements with class="tab-button" and remove the class "active"
            const tabbuttons = document.getElementsByClassName("tab-button");
            for (let i = 0; i < tabbuttons.length; i++) {
                tabbuttons[i].classList.remove("active");
            }

            // Show the current tab, and add an "active" class to the button that opened the tab
            document.getElementById(tabName).style.display = "block";
            document.getElementById(tabName).classList.add("active");
            if (event && event.currentTarget) {
                event.currentTarget.classList.add("active");
            } else { // For programmatic tab opening
                // Try to find the button by a conventional ID if event is null
                const btn = document.getElementById(`tabButton${tabName}`);
                if (btn) btn.classList.add("active");
            }
        }


        function renderNodeDetails(node) {
            const container = document.getElementById('detailsContainer');
            container.innerHTML = ''; // Clear previous content

            // Create Tab Buttons
            const tabContainer = document.createElement('div');
            tabContainer.className = 'tab-container';
            tabContainer.innerHTML = `
                <button class="tab-button active" id="tabButtonNodeProperties" onclick="openTab(event, 'NodeProperties')">Node Properties</button>
                <button class="tab-button" id="tabButtonNodeRelations" onclick="openTab(event, 'NodeRelations')">Relationships</button>
            `;
            container.appendChild(tabContainer);

            // Create Tab Content Divs
            const nodePropsContent = document.createElement('div');
            nodePropsContent.id = 'NodeProperties';
            nodePropsContent.className = 'tab-content active'; // Active by default
            container.appendChild(nodePropsContent);

            const nodeRelationsContent = document.createElement('div');
            nodeRelationsContent.id = 'NodeRelations';
            nodeRelationsContent.className = 'tab-content';
            container.appendChild(nodeRelationsContent);

            // Populate Node Properties Tab
            let attributesHtml = '';
            Object.entries(node.attributes || {}).forEach(([name, attr]) => {
                attributesHtml += `
                    <div class="attribute-item">
                        <div class="attribute-name">${name}</div>
                        <div class="attribute-details">
                            <span>Type: ${attr.type}</span>
                            <span>Indexed: ${attr.indexed ? 'Yes' : 'No'}</span>
                            ${attr.unique ? `<span>Unique: Yes</span>` : ''}
                        </div>
                        <textarea class="form-control" placeholder="Attribute description..."
                                  onchange="updateAttributeDescription('${name}', this.value)"
                                  style="margin-top: 8px; min-height: 60px;">${attr.description || ''}</textarea>
                        
                        <div class="attribute-examples">
                            <div class="examples-title">
                                <span>Example Values:</span>
                                <button class="btn btn-info btn-small" onclick="loadAttributeExamples('${node.label}', '${name}')">
                                    📊 Load Examples
                                </button>
                            </div>
                            <div id="examples-${node.label}-${name}" class="example-values">
                                <span class="no-examples">Click "Load Examples"</span>
                            </div>
                        </div>
                    </div>
                `;
            });

            nodePropsContent.innerHTML = `
                <div class="form-group">
                    <label class="form-label">🏷️ Node Label</label>
                    <input type="text" class="form-control" value="${node.label}" readonly>
                </div>
                
                <div class="form-group">
                    <label class="form-label">📝 Node Description</label>
                    <textarea class="form-control" placeholder="Node description..."
                              onchange="updateNodeDescription(this.value)">${node.description || ''}</textarea>
                </div>

                <div class="examples-section">
                    <div class="examples-header">
                        <h4>📊 Example Nodes</h4>
                        <div class="examples-controls">
                            <span>Limit:</span>
                            <input type="number" class="limit-input" id="nodeExampleLimit" value="10" min="1" max="100">
                            <button class="btn btn-info btn-small" onclick="loadNodeExamples('${node.label}')">
                                🔍 Load Nodes
                            </button>
                        </div>
                    </div>
                    <div id="nodeExamples-${node.label}" class="examples-container" style="display: none;">
                        <!-- Example nodes will be displayed here -->
                    </div>
                </div>

                <div class="attributes-section">
                    <div class="section-title">
                        🔧 Node Attributes (${Object.keys(node.attributes || {}).length})
                    </div>
                    ${attributesHtml}
                </div>
            `;

            // Populate Relationships Tab
            let relationshipsHtml = '';
            Object.entries(node.relationships || {}).forEach(([name, rel]) => {
                // Ensure rel.properties is an object
                rel.properties = rel.properties || {};
                let relPropertiesHtml = '';
                Object.entries(rel.properties).forEach(([propName, propDetails]) => {
                    relPropertiesHtml += `
                        <div class="relationship-property-item">
                            <div class="relationship-property-name">${propName} (Type: ${propDetails.type || 'string'})</div>
                            <textarea class="form-control" placeholder="Property description..."
                                      onchange="updateRelationshipPropertyDescription('${name}', '${propName}', this.value)"
                                      style="margin-top: 4px; font-size: 12px; min-height: 40px;">${propDetails.description || ''}</textarea>
                        </div>
                    `;
                });

                relationshipsHtml += `
                    <div class="relationship-item">
                        <div class="relationship-name">${name}</div>
                        <div class="relationship-details">
                            <span>Target: ${rel.target || 'Not defined'}</span>
                        </div>
                        <textarea class="form-control" placeholder="Relationship description..."
                                  onchange="updateRelationshipDescription('${name}', this.value)"
                                  style="margin-top: 8px; min-height: 60px;">${rel.description || ''}</textarea>
                        
                        <div class="relationship-properties-section">
                            <div class="section-title" style="font-size: 13px; margin-bottom: 8px;">
                                🔩 Relationship Properties (${Object.keys(rel.properties).length})
                                <button class="btn btn-success btn-small" onclick="addRelationshipProperty('${name}')">+ Add Property</button>
                            </div>
                            <div id="rel-props-${node.label}-${name}">
                                ${relPropertiesHtml}
                                ${Object.keys(rel.properties).length === 0 ? '<p style="font-size:12px; color:#6c757d;">No properties defined for this relationship.</p>' : ''}
                            </div>
                        </div>

                        <div class="relationship-examples">
                            <div class="examples-title">
                                <span>Example Relationships:</span>
                                <button class="btn btn-info btn-small" onclick="loadRelationshipExamples('${node.label}', '${name}', '${rel.target || ''}')">
                                    🔗 Load Examples
                                </button>
                            </div>
                            <div id="rel-examples-${node.label}-${name}" class="example-values">
                                <span class="no-examples">Click "Load Examples"</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            nodeRelationsContent.innerHTML = `
                <div class="relationships-section" style="margin-top:0; padding-top:0; border-top:none;">
                    <div class="section-title">
                        🔗 Relationships (${Object.keys(node.relationships || {}).length})
                    </div>
                    ${relationshipsHtml}
                </div>
            `;
            // Default to showing Node Properties tab
            openTab(null, 'NodeProperties');
        }

        function updateNodeDescription(description) {
            if (currentNode === null || !schemaData) return;
            schemaData.node_types[currentNode].description = description;
            updateModifiedStatus(true);
        }

        function updateAttributeDescription(attrName, description) {
            if (currentNode === null || !schemaData) return;
            schemaData.node_types[currentNode].attributes[attrName].description = description;
            updateModifiedStatus(true);
        }

        function updateRelationshipDescription(relName, description) {
            if (currentNode === null || !schemaData) return;
            schemaData.node_types[currentNode].relationships[relName].description = description;
            updateModifiedStatus(true);
        }

        function addRelationshipProperty(relName) {
            if (currentNode === null || !schemaData) return;
            const node = schemaData.node_types[currentNode];
            if (!node.relationships[relName]) return;

            const newPropName = prompt("Enter new relationship property name:");
            if (!newPropName || typeof newPropName !== 'string' || newPropName.trim() === '') {
                alert("Invalid property name.");
                return;
            }
            if (node.relationships[relName].properties && node.relationships[relName].properties[newPropName.trim()]) {
                alert(`Property "${newPropName.trim()}" already exists for this relationship.`);
                return;
            }

            const newPropType = prompt("Enter property type (e.g., string, integer, boolean, date):", "string");
            if (!newPropType) return; // User cancelled

            if (!node.relationships[relName].properties) {
                node.relationships[relName].properties = {};
            }
            node.relationships[relName].properties[newPropName.trim()] = {
                type: newPropType.trim(),
                description: ""
            };
            updateModifiedStatus(true);
            renderNodeDetails(node); // Re-render to show the new property input
            openTab(null, 'NodeRelations'); // Switch to relations tab
        }

        function updateRelationshipPropertyDescription(relName, propName, description) {
            if (currentNode === null || !schemaData) return;
            const node = schemaData.node_types[currentNode];
            if (node && node.relationships && node.relationships[relName] && node.relationships[relName].properties && node.relationships[relName].properties[propName]) {
                node.relationships[relName].properties[propName].description = description;
                updateModifiedStatus(true);
            }
        }

        function updateStats() {
            if (!schemaData || !schemaData.node_types) return;
            document.getElementById('nodeCount').textContent = `${schemaData.node_types.length} Nodes`;
        }

        function filterNodes(event) {
            const searchTerm = event.target.value.toLowerCase();
            const nodes = document.querySelectorAll('.node-item');
            const detailsContainer = document.getElementById('detailsContainer');

            let firstMatchIndex = -1;

            nodes.forEach((nodeItem, index) => {
                const labelElement = nodeItem.querySelector('.node-label');
                const nodeData = schemaData.node_types[index];
                let match = false;

                if (labelElement.textContent.toLowerCase().includes(searchTerm)) {
                    match = true;
                }

                if (!match && nodeData.attributes) {
                    for (const attrName in nodeData.attributes) {
                        if (attrName.toLowerCase().includes(searchTerm) || 
                            (nodeData.attributes[attrName].description && nodeData.attributes[attrName].description.toLowerCase().includes(searchTerm))) {
                            match = true;
                            break;
                        }
                    }
                }

                if (!match && nodeData.relationships) {
                    for (const relName in nodeData.relationships) {
                        if (relName.toLowerCase().includes(searchTerm) || 
                            (nodeData.relationships[relName].description && nodeData.relationships[relName].description.toLowerCase().includes(searchTerm)) ||
                            (nodeData.relationships[relName].target && nodeData.relationships[relName].target.toLowerCase().includes(searchTerm))) {
                            match = true;
                            // Check relationship properties
                            if (nodeData.relationships[relName].properties) {
                                for (const relPropName in nodeData.relationships[relName].properties) {
                                    if (relPropName.toLowerCase().includes(searchTerm) || 
                                        (nodeData.relationships[relName].properties[relPropName].description && 
                                         nodeData.relationships[relName].properties[relPropName].description.toLowerCase().includes(searchTerm))) {
                                        match = true; break;
                                    }
                                }
                            }
                        }
                        if (match) break;
                    }
                }

                if (match) {
                    nodeItem.style.display = '';
                    if (firstMatchIndex === -1) {
                        firstMatchIndex = index;
                    }
                } else {
                    nodeItem.style.display = 'none';
                }
            });

            // If there's a match and no node is currently selected, or selected is hidden, select the first match
            if (firstMatchIndex !== -1) {
                const currentSelectedNodeItem = document.querySelector('.node-header.active');
                if (!currentSelectedNodeItem || currentSelectedNodeItem.closest('.node-item').style.display === 'none') {
                    selectNode(firstMatchIndex);
                }
            } else if (searchTerm) {
                 detailsContainer.innerHTML = `<div class="no-selection"><p>No matches found for "${searchTerm}"</p></div>`;
            } else if (!document.querySelector('.node-header.active')) {
                 detailsContainer.innerHTML = `<div class="no-selection"><p>Select a node to edit</p></div>`;
            }
        }

        function downloadSchema() {
            if (!schemaData) {
                alert('No schema to download.');
                return;
            }
            if (!schemaData.version) schemaData.version = 0;
            schemaData.version += 1;
            schemaData.timestamp = new Date().toISOString();
            updateSchemaInfoDisplay('JSON File (Saved)', schemaData.version, schemaData.timestamp);
            updateModifiedStatus(false); // Mark as unmodified after saving

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(schemaData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            const fileName = localSchemaFilePath ? localSchemaFilePath.replace(/\.json$/i, '') + `_v${schemaData.version}.json` : `schema_v${schemaData.version}.json`;
            downloadAnchorNode.setAttribute("download", fileName);
            document.body.appendChild(downloadAnchorNode); 
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }

        function exportToCypher() {
            if (!schemaData) {
                alert('No schema to export.');
                return;
            }

            let cypherCommands = [];
            const currentTimestamp = new Date().toISOString();

            if (typeof schemaData.version !== 'number' || schemaData.version < 1) {
                schemaData.version = 1; 
            }
            if (typeof schemaData.timestamp !== 'string') {
                schemaData.timestamp = currentTimestamp;
            }

            let schemaJsonStringForCypherExport = JSON.stringify(schemaData, null, 2); 
            schemaJsonStringForCypherExport = schemaJsonStringForCypherExport.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            const schemaMetadataCypherCommand = `
// --- migRaven Schema Metadata (Version: ${schemaData.version}, Timestamp: ${schemaData.timestamp}) ---
MERGE (s:migRaven_Schema {metaId: '${GLOBAL_SCHEMA_META_ID}'})
ON CREATE SET
    s.version = ${schemaData.version},
    s.timestamp = '${schemaData.timestamp}',
    s.schemaData = '${schemaJsonStringForCypherExport}',
    s.createdAt = datetime({timezone: 'UTC'}),
    s.updatedAt = datetime({timezone: 'UTC'})
ON MATCH SET
    s.version = ${schemaData.version},
    s.timestamp = '${schemaData.timestamp}',
    s.schemaData = '${schemaJsonStringForCypherExport}',
    s.updatedAt = datetime({timezone: 'UTC'});
`;
            cypherCommands.push(schemaMetadataCypherCommand);
            cypherCommands.push("\n// --- Individual Schema Element Definitions ---");

            schemaData.node_types.forEach(node => {
                cypherCommands.push(`\n// Schema for Node Label: ${node.label}`);
                let idAttribute = Object.keys(node.attributes).find(attr => attr.toLowerCase() === 'id' || attr.toLowerCase() === 'name');
                if (idAttribute) {
                     cypherCommands.push(`CREATE CONSTRAINT IF NOT EXISTS ON (n:${node.label}) ASSERT n.${idAttribute} IS UNIQUE;`);
                } 
                
                Object.entries(node.attributes).forEach(([attrName, attrDetails]) => {
                    if (attrDetails.indexed) {
                        cypherCommands.push(`CREATE INDEX IF NOT EXISTS FOR (n:${node.label}) ON (n.${attrName});`);
                    }
                    if (attrDetails.unique && !(idAttribute && attrName === idAttribute) ) { 
                         cypherCommands.push(`CREATE CONSTRAINT IF NOT EXISTS ON (n:${node.label}) ASSERT n.${attrName} IS UNIQUE;`);
                    }
                });
            });
            
            lastCypherQueryForExport = cypherCommands.join('\n');
            document.getElementById('cypherPreview').value = lastCypherQueryForExport;
            document.getElementById('cypherModal').style.display = 'block';
        }

        function closeCypherModal() {
            document.getElementById('cypherModal').style.display = 'none';
        }

        function confirmCypherExport() {
            if (!lastCypherQueryForExport) {
                alert('No Cypher query generated.');
                return;
            }
            const dataStr = "data:application/vnd.neo4j.cypher;charset=utf-8," + encodeURIComponent(lastCypherQueryForExport);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            const fileName = `migRaven_schema_export_v${schemaData.version || '1'}.cypher`;
            downloadAnchorNode.setAttribute("download", fileName);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            closeCypherModal();
        }

        // ===== SAVE TO NEO4J =====
        async function saveSchemaToNeo4j() {
            if (!schemaData) {
                alert('No local schema to save.');
                return;
            }
            if (!isModified) {
                let allowUnmodifiedSave = !dbSchemaInfo || !dbSchemaInfo.metaId;
                if (dbSchemaInfo && dbSchemaInfo.version !== schemaData.version) {
                    allowUnmodifiedSave = true;
                }
                if (!allowUnmodifiedSave) {
                    alert('No changes to save to the database.');
                    return;
                }
            }
            if (!neo4jConfig.connected || !neo4jDriver) {
                alert('Not connected to Neo4j. Please test connection first.');
                return;
            }

            if (isModified || !schemaData.version) { 
                if (!schemaData.version) schemaData.version = 0;
                schemaData.version += 1;
                schemaData.timestamp = new Date().toISOString();
            } else if (!schemaData.timestamp) { 
                 schemaData.timestamp = new Date().toISOString();
            }
            
            updateSchemaInfoDisplay(
                'Local (Pending Save to DB)', 
                schemaData.version, 
                schemaData.timestamp
            );

            const statusDiv = document.getElementById('connectionStatus');
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<div class="connection-warning">🔄 Saving schema to Neo4j...</div>`;

            let originalVersionBeforeSaveAttempt = schemaData.version;

            try {
                let currentDbSchema = null;
                try {
                    const dbResult = await executeNeo4jQuery(
                        `MATCH (s:migRaven_Schema {metaId: $metaId}) 
                         RETURN s.version AS version, s.timestamp AS timestamp, s.schemaData AS schemaData, s.createdAt AS createdAt, s.updatedAt AS updatedAt LIMIT 1`,
                        { metaId: GLOBAL_SCHEMA_META_ID }
                    );
                    if (dbResult.length > 0) {
                        currentDbSchema = { 
                            version: dbResult[0].version, 
                            timestamp: dbResult[0].timestamp, 
                            createdAt: dbResult[0].createdAt,
                            updatedAt: dbResult[0].updatedAt
                        };
                    }
                } catch (fetchError) {
                    console.warn("Could not fetch existing DB schema, proceeding with create/overwrite logic:", fetchError);
                }

                if (currentDbSchema) {
                    let proceed = true;
                    if (schemaData.version < currentDbSchema.version) {
                        proceed = confirm(`WARNING: The schema in the database (Version: ${currentDbSchema.version}, Updated: ${new Date(currentDbSchema.updatedAt || currentDbSchema.timestamp).toLocaleString()}) is NEWER than your local schema (Version: ${schemaData.version}). Overwriting will result in data loss. Do you want to proceed?`);
                    } else if (schemaData.version === currentDbSchema.version && schemaData.timestamp < currentDbSchema.timestamp) {
                        proceed = confirm(`WARNING: The schema in the database (Version: ${currentDbSchema.version}, Updated: ${new Date(currentDbSchema.updatedAt || currentDbSchema.timestamp).toLocaleString()}) has a more recent logical timestamp than your local schema for the same version. This might indicate concurrent edits. Overwrite with your local changes?`);
                    } else if (schemaData.version === currentDbSchema.version && new Date(schemaData.timestamp).getTime() < new Date(currentDbSchema.updatedAt || currentDbSchema.timestamp).getTime()) {
                         proceed = confirm(`WARNING: The schema in the database (Version: ${currentDbSchema.version}) appears to have been updated more recently (DB Updated: ${new Date(currentDbSchema.updatedAt).toLocaleString()}) than your local schema's timestamp, even if logical timestamps are similar. Overwrite with your local changes?`);
                    }

                    if (!proceed) {
                        statusDiv.innerHTML = `<div class="connection-warning">Save to DB cancelled by user.</div>`;
                        if (isModified || originalVersionBeforeSaveAttempt !== schemaData.version) {
                           schemaData.version = originalVersionBeforeSaveAttempt -1; 
                           if(schemaData.version < 0) schemaData.version = 0; 
                        }
                        updateSchemaInfoDisplay('Local JSON (Save Cancelled)', schemaData.version, schemaData.timestamp);
                        return;
                    }
                }

                const schemaStringForDbParam = JSON.stringify(schemaData);

                const cypherSaveQuery = `
                    MERGE (s:migRaven_Schema {metaId: $metaId})
                    ON CREATE SET
                        s.version = $version,
                        s.timestamp = $timestamp,
                        s.schemaData = $schemaDataString,
                        s.createdAt = datetime(),
                        s.updatedAt = datetime()
                    ON MATCH SET
                        s.version = $version,
                        s.timestamp = $timestamp,
                        s.schemaData = $schemaDataString,
                        s.updatedAt = datetime()
                    RETURN s.version AS version, s.timestamp AS timestamp, s.metaId AS metaId, s.createdAt AS createdAt, s.updatedAt AS updatedAt
                `;
                const params = {
                    metaId: GLOBAL_SCHEMA_META_ID,
                    version: schemaData.version,
                    timestamp: schemaData.timestamp,
                    schemaDataString: schemaStringForDbParam
                };

                const saveResult = await executeNeo4jQuery(cypherSaveQuery, params);

                if (saveResult && saveResult.length > 0) {
                    dbSchemaInfo = {
                        version: saveResult[0].version,
                        timestamp: saveResult[0].timestamp, 
                        metaId: saveResult[0].metaId,
                        createdAt: saveResult[0].createdAt,
                        updatedAt: saveResult[0].updatedAt 
                    };
                     updateSchemaInfoDisplay(
                        `Database (Synced at ${new Date(dbSchemaInfo.updatedAt).toLocaleString()})`, 
                        dbSchemaInfo.version, 
                        dbSchemaInfo.timestamp 
                    );
                } else {
                    dbSchemaInfo = { version: schemaData.version, timestamp: schemaData.timestamp };
                     updateSchemaInfoDisplay(
                        'Database (Synced, but no confirmation details)', 
                        schemaData.version, 
                        schemaData.timestamp
                    );
                }
                
                updateModifiedStatus(false); 
                statusDiv.innerHTML = `<div class="connection-success">✅ Schema successfully saved to Neo4j (Version: ${dbSchemaInfo.version}).</div>`;
                document.getElementById('compareBtn').disabled = false;

            } catch (error) {
                console.error("Error saving schema to Neo4j:", error);
                statusDiv.innerHTML = `<div class="connection-error">❌ Error saving schema to Neo4j: ${error.message}</div>`;
                if (isModified || originalVersionBeforeSaveAttempt !== schemaData.version) {
                    schemaData.version = originalVersionBeforeSaveAttempt -1;
                    if(schemaData.version < 0) schemaData.version = 0; 
                }
                updateSchemaInfoDisplay('Local JSON (Save Failed)', schemaData.version, schemaData.timestamp);
            }
        }

        async function compareWithDbSchema() {
            if (!schemaData) {
                alert('Load a local schema first to compare.');
                return;
            }
            if (!neo4jConfig.connected || !neo4jDriver) {
                alert('Not connected to Neo4j. Please test connection first.');
                return;
            }

            const comparisonDiv = document.getElementById('comparisonResults');
            const comparisonText = document.getElementById('comparisonText');
            comparisonDiv.style.display = 'block';
            comparisonText.innerHTML = '🔄 Fetching database schema...';

            try {
                const dbResult = await executeNeo4jQuery(
                    `MATCH (s:migRaven_Schema {metaId: $metaId}) 
                     RETURN s.version AS version, s.timestamp AS timestamp, s.schemaData AS schemaData, s.createdAt, s.updatedAt LIMIT 1`,
                    { metaId: GLOBAL_SCHEMA_META_ID }
                );

                if (dbResult.length === 0) {
                    comparisonText.innerHTML = `⚠️ No schema found in the database with metaId '${GLOBAL_SCHEMA_META_ID}'. You can save the current local schema to the database.`;
                    dbSchemaInfo = null; 
                     updateSchemaInfoDisplay(
                        document.getElementById('schemaSource').textContent.startsWith('JSON') ? 'JSON File' : document.getElementById('schemaSource').textContent, 
                        schemaData.version,
                        schemaData.timestamp,
                        " (DB schema not found)"
                    );
                    return;
                }

                const dbSchemaRecord = dbResult[0];
                dbSchemaInfo = { 
                    version: dbSchemaRecord.version,
                    timestamp: dbSchemaRecord.timestamp, 
                    schemaDataString: dbSchemaRecord.schemaData,
                    createdAt: dbSchemaRecord.createdAt,
                    updatedAt: dbSchemaRecord.updatedAt 
                };

                let dbParsedSchema;
                try {
                    if (typeof dbSchemaRecord.schemaData !== 'string') {
                        throw new Error("schemaData from DB is not a string.");
                    }
                    dbParsedSchema = JSON.parse(dbSchemaRecord.schemaData);
                } catch (e) {
                    comparisonText.innerHTML = `❌ Error parsing schema data from database: ${e.message}. DB raw data: ${String(dbSchemaRecord.schemaData).substring(0,100)}...`;
                    return;
                }
                
                updateSchemaInfoDisplay( 
                    `Database (Compared at ${new Date(dbSchemaInfo.updatedAt || Date.now()).toLocaleString()})`,
                    dbSchemaInfo.version,
                    dbSchemaInfo.timestamp
                );

                let differences = [];
                if (schemaData.version > dbParsedSchema.version) {
                    differences.push(`Local schema version (${schemaData.version}) is newer than DB version (${dbParsedSchema.version}).`);
                } else if (schemaData.version < dbParsedSchema.version) {
                    differences.push(`<strong>Warning:</strong> DB schema version (${dbParsedSchema.version}) is newer than local version (${schemaData.version}). Consider reloading from DB.`);
                } else { 
                    if (new Date(schemaData.timestamp) > new Date(dbParsedSchema.timestamp)) {
                        differences.push(`Local schema (v${schemaData.version}) has a more recent logical timestamp (${schemaData.timestamp}) than DB schema (${dbParsedSchema.timestamp}).`);
                    } else if (new Date(schemaData.timestamp) < new Date(dbParsedSchema.timestamp)) {
                        differences.push(`<strong>Warning:</strong> DB schema (v${schemaData.version}) has a more recent logical timestamp (${dbParsedSchema.timestamp}) than local schema (${schemaData.timestamp}).`);
                    }
                }
                 if (new Date(dbSchemaInfo.updatedAt) > new Date(schemaData.timestamp) && schemaData.version <= dbParsedSchema.version) {
                    differences.push(`DB schema node was physically updated (${new Date(dbSchemaInfo.updatedAt).toLocaleString()}) more recently than the local schema's logical timestamp.`);
                }

                const localNodeLabels = new Set(schemaData.node_types.map(nt => nt.label));
                const dbNodeLabels = new Set(dbParsedSchema.node_types.map(nt => nt.label));

                localNodeLabels.forEach(label => {
                    if (!dbNodeLabels.has(label)) differences.push(`Node type "${label}" exists locally but not in DB schema.`);
                });
                dbNodeLabels.forEach(label => {
                    if (!localNodeLabels.has(label)) differences.push(`Node type "${label}" exists in DB schema but not locally.`);
                });

                if (differences.length === 0) {
                    comparisonText.innerHTML = '✅ Local schema and database schema appear to be in sync (based on version, timestamp, and node labels).';
                } else {
                    comparisonText.innerHTML = '<strong>Differences found:</strong><ul><li>' + differences.join('</li><li>') + '</li></ul>';
                }

            } catch (error) {
                console.error("Error comparing with DB schema:", error);
                comparisonText.innerHTML = `❌ Error comparing with DB schema: ${error.message}`;
                 updateSchemaInfoDisplay(
                    document.getElementById('schemaSource').textContent.startsWith('JSON') ? 'JSON File' : document.getElementById('schemaSource').textContent,
                    schemaData.version,
                    schemaData.timestamp,
                    " (DB comparison failed)"
                );
            }
        }

        async function loadSchemaFromNeo4j() {
            if (!neo4jConfig.connected || !neo4jDriver) {
                alert('Not connected to Neo4j. Please test connection first.');
                return;
            }

            const statusDiv = document.getElementById('connectionStatus');
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<div class="connection-warning">🔄 Fetching schema from Neo4j...</div>`;

            const comparisonDiv = document.getElementById('comparisonResults');
            const comparisonText = document.getElementById('comparisonText');
            comparisonDiv.style.display = 'none';
            comparisonText.innerHTML = 'No comparison performed yet.';

            try {
                const dbResult = await executeNeo4jQuery(
                    `MATCH (s:migRaven_Schema {metaId: $metaId}) 
                     RETURN s.version AS version, s.timestamp AS timestamp, s.schemaData AS schemaData, s.createdAt, s.updatedAt LIMIT 1`,
                    { metaId: GLOBAL_SCHEMA_META_ID }
                );

                if (dbResult.length === 0) {
                    statusDiv.innerHTML = `<div class="connection-error">❌ No schema found in the database with metaId '${GLOBAL_SCHEMA_META_ID}'.</div>`;
                    alert(`No schema found in the database with metaId '${GLOBAL_SCHEMA_META_ID}'. You can save a local schema to the database first.`);
                    dbSchemaInfo = null;
                    // Do not clear existing local schema if DB schema is not found
                    // updateSchemaInfoDisplay('Database', 'N/A', 'N/A', ' (Not found)');
                    return;
                }

                const dbSchemaRecord = dbResult[0];
                dbSchemaInfo = { 
                    version: dbSchemaRecord.version,
                    timestamp: dbSchemaRecord.timestamp, 
                    schemaDataString: dbSchemaRecord.schemaData,
                    createdAt: dbSchemaRecord.createdAt,
                    updatedAt: dbSchemaRecord.updatedAt,
                    metaId: GLOBAL_SCHEMA_META_ID
                };

                let loadedDbSchema;
                try {
                    if (typeof dbSchemaRecord.schemaData !== 'string') {
                        throw new Error("schemaData from DB is not a string.");
                    }
                    loadedDbSchema = JSON.parse(dbSchemaRecord.schemaData);
                } catch (e) {
                    statusDiv.innerHTML = `<div class="connection-error">❌ Error parsing schema data from database: ${e.message}.</div>`;
                    alert(`Error parsing schema data from database: ${e.message}. DB raw data: ${String(dbSchemaRecord.schemaData).substring(0,100)}...`);
                    return;
                }

                // Successfully loaded and parsed schema from DB
                schemaData = loadedDbSchema; // Replace local schema with DB schema
                localSchemaFilePath = null; // Reset file path as it's from DB now
                isModified = false; // Loaded from DB, so it's not modified initially

                renderTreeView();
                updateStats();
                updateSchemaInfoDisplay(
                    `Database (Loaded at ${new Date(dbSchemaInfo.updatedAt || Date.now()).toLocaleString()})`,
                    dbSchemaInfo.version,
                    dbSchemaInfo.timestamp
                );

                document.getElementById('downloadBtn').disabled = false;
                document.getElementById('cypherBtn').disabled = false;
                document.getElementById('saveToDbBtn').disabled = true; // No modifications yet
                document.getElementById('compareBtn').disabled = false;
                document.getElementById('statsBar').style.display = 'flex';
                
                statusDiv.innerHTML = `<div class="connection-success">✅ Schema successfully loaded from Neo4j (Version: ${dbSchemaInfo.version}).</div>`;
                updateModifiedStatus(false);

            } catch (error) {
                console.error("Error loading schema from Neo4j:", error);
                statusDiv.innerHTML = `<div class="connection-error">❌ Error loading schema from Neo4j: ${error.message}</div>`;
                alert(`Error loading schema from Neo4j: ${error.message}`);
                // updateSchemaInfoDisplay('Database', 'N/A', 'N/A', ' (Load failed)');
            }
        }

        async function generateSchemaFromDb() {
            if (!neo4jConfig.connected || !neo4jDriver) {
                alert('Not connected to Neo4j. Please test connection first.');
                return;
            }

            const statusDiv = document.getElementById('connectionStatus');
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<div class="connection-warning">🔄 Generating schema from database... This may take a while.</div>`;

            try {
                // 1. Get all labels, excluding those starting with 'p'
                const labelsResult = await executeNeo4jQuery(
                    "CALL db.labels() YIELD label WHERE NOT label STARTS WITH 'p' RETURN label"
                );
                const nodeLabels = labelsResult.map(record => record.label);

                const newSchema = {
                    version: 1,
                    timestamp: new Date().toISOString(),
                    description: "Schema generated from Neo4j database on " + new Date().toLocaleDateString(),
                    node_types: []
                };

                for (const label of nodeLabels) {
                    const nodeType = {
                        label: label,
                        description: `Description for ${label}`,
                        attributes: {},
                        relationships: {}
                    };

                    // 2. Get properties for each label
                    //    We need to sample some nodes to infer property types.
                    //    Using apoc.meta.schema is better if available, but sticking to basic Cypher for now.
                    const propsResult = await executeNeo4jQuery(
                        `MATCH (n:\`${label}\`) WITH n LIMIT 100 // Sample 100 nodes
                         UNWIND keys(n) AS key
                         RETURN DISTINCT key, apoc.meta.type(n[key]) AS type`, 
                        {}
                    );

                    propsResult.forEach(prop => {
                        nodeType.attributes[prop.key] = {
                            type: prop.type || 'string', // Default to string if type detection fails
                            description: `Description for ${prop.key}`,
                            indexed: false, // Cannot reliably determine from basic Cypher
                            unique: false   // Cannot reliably determine
                        };
                    });

                    // 3. Get relationships and their properties for each label
                    const relsResult = await executeNeo4jQuery(
                        `MATCH (n:\`${label}\`)-[r]->(m) 
                         WITH type(r) AS relType, r, m LIMIT 500 // Sample relationships
                         UNWIND keys(r) AS propKey
                         RETURN DISTINCT relType, labels(m)[0] AS targetLabel, propKey, apoc.meta.type(r[propKey]) AS propType`,
                        {}
                    ); 
                    
                    const distinctRels = await executeNeo4jQuery(
                        `MATCH (n:\`${label}\`)-[r]->(m) RETURN DISTINCT type(r) as relType, labels(m)[0] AS targetLabel`
                    );

                    distinctRels.forEach(rel => {
                        if (!nodeType.relationships[rel.relType]) {
                            nodeType.relationships[rel.relType] = {
                                target: rel.targetLabel || 'Unknown',
                                description: `Relationship ${rel.relType} to ${rel.targetLabel || 'Unknown'}`,
                                properties: {}
                            };
                        }
                    });

                    relsResult.forEach(relProp => {
                        if (nodeType.relationships[relProp.relType]) {
                            nodeType.relationships[relProp.relType].properties[relProp.propKey] = {
                                type: relProp.propType || 'string',
                                description: `Description for ${relProp.propKey} on ${relProp.relType}`
                            };
                        }
                    });

                    newSchema.node_types.push(nodeType);
                }

                schemaData = newSchema;
                localSchemaFilePath = `generated_schema_v${schemaData.version}.json`;
                isModified = true; // Mark as modified as it's a new schema
                dbSchemaInfo = null; // This is a new schema, not directly from the :migRaven_Schema node

                renderTreeView();
                updateStats();
                updateSchemaInfoDisplay(
                    'Generated from DB',
                    schemaData.version,
                    schemaData.timestamp
                );
                if (currentNode !== null && currentNode < schemaData.node_types.length) {
                    selectNode(currentNode); // Reselect if possible
                } else if (schemaData.node_types.length > 0) {
                    selectNode(0); // Select first node
                } else {
                    document.getElementById('detailsContainer').innerHTML = '<div class="no-selection"><p>Schema generated, but no node types found or an error occurred.</p></div>';
                }

                updateModifiedStatus(true);
                document.getElementById('downloadBtn').disabled = false;
                document.getElementById('cypherBtn').disabled = false;
                document.getElementById('saveToDbBtn').disabled = false; // Allow saving this new schema
                document.getElementById('compareBtn').disabled = true; // Comparison is not relevant for a freshly generated schema

                statusDiv.innerHTML = `<div class="connection-success">✅ Schema successfully generated from database (${newSchema.node_types.length} node types found).</div>`;
                alert('Schema generation complete. Review and save the schema.');

            } catch (error) {
                console.error("Error generating schema from DB:", error);
                statusDiv.innerHTML = `<div class="connection-error">❌ Error generating schema: ${error.message}. Check console for details. Ensure APOC is installed for better type detection.</div>`;
                alert(`Error generating schema: ${error.message}. You might need APOC library installed in Neo4j for full schema inference (e.g., property types).`);
            }
        }

// Add any helper functions that were inside the old <script> tag but are not event handlers or main functions here
// For example, if there were utility functions not directly tied to an event or a major action.
// Ensure all functions called by inline HTML event attributes (onclick, onchange) are globally accessible 
// or refactor them to use addEventListener in the DOMContentLoaded callback.
// For simplicity, this example keeps them global as they were in the original script tag.

