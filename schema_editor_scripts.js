// Schema Editor Scripts
let schemaData = null;
let currentNode = null;
let isModified = false;
let neo4jDriver = null;
let lastCypherQueryForExport = "";
let dbSchemaInfo = null; // To store version/timestamp from DB
let localSchemaFilePath = null; // To store the path/name of the loaded JSON file for re-saving
const GLOBAL_SCHEMA_META_ID = "_migRaven_Schema"; // Added constant

// Tracking geänderter Properties
let changedProperties = {
  nodes: {}, // Format: {nodeLabel: {propertyName: {oldValue, newValue, timestamp}}}
  relationships: {}, // Format: {sourceLabel_relType_targetLabel: {propertyName: {oldValue, newValue, timestamp}}}
  count: 0, // Gesamtzahl der geänderten Properties
};

// ===== HELPER FUNCTIONS FOR DIFFERENTIAL UPDATES =====

function deepCompareProperties(props1, props2) {
  // Helper function to compare two property objects deeply
  const keys1 = Object.keys(props1).sort();
  const keys2 = Object.keys(props2).sort();

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) {
      return false;
    }

    const prop1 = props1[keys1[i]];
    const prop2 = props2[keys1[i]];

    if (typeof prop1 !== typeof prop2) {
      return false;
    }

    if (typeof prop1 === "object") {
      if (!deepCompareProperties(prop1, prop2)) {
        return false;
      }
    } else if (prop1 !== prop2) {
      return false;
    }
  }

  return true;
}

function hasSignificantChanges(node1, node2) {
  // Check if there are significant changes that warrant an update
  if (node1.description !== node2.description) {
    return true;
  }

  return !deepCompareProperties(node1.properties || {}, node2.properties || {});
}

// Neo4j Connection Configuration
const neo4jConfig = {
  url: "",
  username: "",
  password: "",
  database: "", // Added database field
  connected: false,
};

document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM fully loaded");

  // File and search event listeners
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileLoad);
    console.log("Added fileInput listener");
  } else {
    console.error("fileInput not found!");
  }

  const searchBox = document.getElementById("searchBox");
  if (searchBox) {
    searchBox.addEventListener("input", filterNodes);
    console.log("Added searchBox listener");
  }

  // Neo4j config event listeners
  const testConnectionBtn = document.getElementById("testConnectionBtn");
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener("click", testConnection);
    console.log("Added testConnection listener");
  }

  const toggleConfigBtn = document.getElementById("toggleConfigBtn");
  if (toggleConfigBtn) {
    toggleConfigBtn.addEventListener("click", toggleNeo4jConfig);
    console.log("Added toggleConfig listener");
  }

  // Button event listeners
  const loadJSONBtn = document.getElementById("loadJSONBtn");
  if (loadJSONBtn) {
    loadJSONBtn.addEventListener("click", function () {
      const fileInput = document.getElementById("fileInput");
      if (fileInput) fileInput.click();
    });
    console.log("Added loadJSON listener");
  }

  const loadFromDbBtn = document.getElementById("loadFromDbBtn");
  if (loadFromDbBtn) {
    loadFromDbBtn.addEventListener("click", loadSchemaFromNeo4j);
    console.log("Added loadFromDb listener");
  }

  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", downloadSchema);
    console.log("Added download listener");
  }

  const saveToDbBtn = document.getElementById("saveToDbBtn");
  if (saveToDbBtn) {
    saveToDbBtn.addEventListener("click", saveSchemaToNeo4j);
    console.log("Added saveToDb listener");
  }

  const cypherBtn = document.getElementById("cypherBtn");
  if (cypherBtn) {
    cypherBtn.addEventListener("click", exportToCypher);
    console.log("Added cypher listener");
  }

  const compareBtn = document.getElementById("compareBtn");
  if (compareBtn) {
    compareBtn.addEventListener("click", compareWithDbSchema);
    console.log("Added compare listener");
  }

  const generateSchemaBtn = document.getElementById("generateSchemaBtn");
  if (generateSchemaBtn) {
    generateSchemaBtn.addEventListener("click", generateSchemaFromDb);
    console.log("Added generateSchema listener");
  }

  // Modal event listeners
  const closeCypherModalBtn = document.getElementById("closeCypherModalBtn");
  if (closeCypherModalBtn) {
    closeCypherModalBtn.addEventListener("click", closeCypherModal);
    console.log("Added closeCypherModal listener");
  }

  const cancelCypherBtn = document.getElementById("cancelCypherBtn");
  if (cancelCypherBtn) {
    cancelCypherBtn.addEventListener("click", closeCypherModal);
    console.log("Added cancelCypher listener");
  }
  const confirmCypherBtn = document.getElementById("confirmCypherBtn");
  if (confirmCypherBtn) {
    confirmCypherBtn.addEventListener("click", confirmCypherExport);
    console.log("Added confirmCypher listener");
  }
});

function updateModifiedStatus(modified) {
  isModified = modified;
  document.getElementById("modifiedIndicator").style.display = modified
    ? "inline"
    : "none";
  if (modified && schemaData) {
    schemaData.timestamp = new Date().toISOString();
    // Version is incremented upon explicit save actions (download or save to DB)
    updateSchemaInfoDisplay(
      document.getElementById("schemaSource").textContent || "JSON File",
      schemaData.version,
      schemaData.timestamp
    );
  }
  // Enable/disable save buttons based on modification status and schema presence
  const hasSchema = !!schemaData;
  document.getElementById("downloadBtn").disabled = !hasSchema;
  document.getElementById("cypherBtn").disabled = !hasSchema;
  document.getElementById("saveToDbBtn").disabled = !hasSchema || !isModified;
  document.getElementById("loadFromDbBtn").disabled = !neo4jConfig.connected; // Disable if not connected
  document.getElementById("generateSchemaBtn").disabled =
    !neo4jConfig.connected; // Disable if not connected
}

function toggleNeo4jConfig() {
  const detailsDiv = document.getElementById("neo4jConfigDetails");
  const indicator = document.getElementById("configToggleIndicator");
  const section = document.getElementById("neo4jConfigSection");
  const testConnectionBtn = document.getElementById("testConnectionBtn");

  if (detailsDiv.style.display === "none") {
    detailsDiv.style.display = "block";
    indicator.textContent = "(-)";
    section.classList.remove("minimized");
    testConnectionBtn.style.display = "inline-block"; // Show button when expanded
  } else {
    detailsDiv.style.display = "none";
    indicator.textContent = "(+)";
    section.classList.add("minimized");
    testConnectionBtn.style.display = "none"; // Hide button when minimized
  }
}

// ===== NEO4J CONNECTION =====

async function testConnection() {
  const urlInput = document.getElementById("neo4jUrl").value;
  const userInput = document.getElementById("neo4jUser").value;
  const passwordInput = document.getElementById("neo4jPassword").value;
  const databaseInput = document.getElementById("neo4jDatabase").value.trim(); // Get database name

  const statusDiv = document.getElementById("connectionStatus");
  statusDiv.style.display = "block";
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
    neo4jDriver = neo4j.driver(
      urlInput,
      neo4j.auth.basic(userInput, passwordInput)
    );
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

    statusDiv.innerHTML = `<div class="connection-success">✅ Connection successful! (DB: ${
      databaseInput || "default"
    })</div>`;
    if (schemaData) document.getElementById("compareBtn").disabled = false;
    document.getElementById("loadFromDbBtn").disabled = false; // Enable load from DB button
    document.getElementById("generateSchemaBtn").disabled = false; // Enable generate schema button

    // Minimize config section on successful connection
    const configDetails = document.getElementById("neo4jConfigDetails");
    if (configDetails.style.display !== "none") {
      toggleNeo4jConfig();
    }
  } catch (error) {
    neo4jConfig.connected = false;
    neo4jDriver = null;
    statusDiv.innerHTML = `<div class="connection-error">❌ Connection failed: ${error.message}</div>`;
    document.getElementById("compareBtn").disabled = true;
    document.getElementById("loadFromDbBtn").disabled = true; // Disable on connection error
    document.getElementById("generateSchemaBtn").disabled = true; // Disable on connection error
  }
}

// ===== LOAD EXAMPLE VALUES =====

async function loadNodeExamples(nodeLabel) {
  const limit = document.getElementById("nodeExampleLimit").value || 10;
  const container = document.getElementById(`nodeExamples-${nodeLabel}`);

  if (!neo4jConfig.connected || !neo4jDriver) {
    showConnectionWarning(container, "Load Node Examples");
    return;
  }

  container.style.display = "block";
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
  const container = document.getElementById(
    `examples-${nodeLabel}-${attributeName}`
  );

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

async function loadRelationshipExamples(
  sourceLabel,
  relationshipName,
  targetLabel
) {
  const container = document.getElementById(
    `rel-examples-${sourceLabel}-${relationshipName}`
  );

  if (!neo4jConfig.connected || !neo4jDriver) {
    showConnectionWarning(container, "Load Relationship Examples");
    return;
  }

  container.innerHTML = `<div class="loading-spinner"></div> Loading...`;

  try {
    const query =
      targetLabel && targetLabel !== "null"
        ? `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b:${targetLabel})
                     RETURN a.name as source_name, type(r) as rel_type, b.name as target_name
                     LIMIT 10`
        : `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b)
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
    return result.records.map((record) => {
      const obj = {};
      record.keys.forEach((key) => {
        let value = record.get(key);
        if (neo4j.isInt(value)) {
          value = value.toNumber();
        } else if (
          typeof value === "object" &&
          value !== null &&
          value.properties
        ) {
          value = value.properties;
        }
        obj[key] = value;
      });
      return obj;
    });
  } catch (error) {
    console.error(
      "Neo4j Query Error:",
      error,
      "Query:",
      query,
      "Params:",
      params
    );
    throw error;
  } finally {
    await session.close();
  }
}

// ===== INDEX MANAGEMENT FOR PERFORMANCE =====

async function ensureMigRavenSchemaIndexes() {
  if (!neo4jConfig.connected || !neo4jDriver) {
    console.warn("Cannot create indexes - not connected to Neo4j");
    return;
  }
  const requiredIndexes = [
    {
      name: "_migRaven_Schema_nodeType_idx",
      query:
        "CREATE INDEX _migRaven_Schema_nodeType_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.nodeType)",
      description: "Index on nodeType for fast filtering by node type",
    },
    {
      name: "_migRaven_Schema_originalLabel_idx",
      query:
        "CREATE INDEX _migRaven_Schema_originalLabel_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.originalLabel)",
      description: "Index on originalLabel for fast node label lookups",
    },
    {
      name: "_migRaven_Schema_schemaVersion_idx",
      query:
        "CREATE INDEX _migRaven_Schema_schemaVersion_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.schemaVersion)",
      description: "Index on schemaVersion for version-based queries",
    },
    {
      name: "_migRaven_Schema_timestamp_idx",
      query:
        "CREATE INDEX _migRaven_Schema_timestamp_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.timestamp)",
      description: "Index on timestamp for temporal queries",
    },
    {
      name: "_migRaven_Schema_composite_idx",
      query:
        "CREATE INDEX _migRaven_Schema_composite_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.nodeType, n.schemaVersion)",
      description:
        "Composite index on nodeType and schemaVersion for common query patterns",
    },
    {
      name: "_migRaven_Schema_properties_idx",
      query:
        "CREATE INDEX _migRaven_Schema_properties_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.properties)",
      description:
        "Index on properties field for faster property-based searches",
    },
    {
      name: "_migRaven_Schema_description_idx",
      query:
        "CREATE INDEX _migRaven_Schema_description_idx IF NOT EXISTS FOR (n:_migRaven_Schema) ON (n.description)",
      description: "Index on description field for text-based searches",
    },
  ];

  try {
    console.log(
      "🔍 Checking and creating necessary indexes for _migRaven_Schema nodes..."
    );

    // Get existing indexes
    const existingIndexes = await executeNeo4jQuery("SHOW INDEXES");
    const existingIndexNames = new Set(existingIndexes.map((idx) => idx.name));

    let createdCount = 0;
    for (const index of requiredIndexes) {
      if (!existingIndexNames.has(index.name)) {
        try {
          await executeNeo4jQuery(index.query);
          console.log(`✅ Created index: ${index.name} - ${index.description}`);
          createdCount++;
        } catch (error) {
          // Index might already exist with different name, or there might be compatibility issues
          console.warn(
            `⚠️ Could not create index ${index.name}: ${error.message}`
          );
        }
      } else {
        console.log(`✅ Index already exists: ${index.name}`);
      }
    }

    if (createdCount > 0) {
      console.log(
        `🚀 Created ${createdCount} new indexes for better performance`
      );
    } else {
      console.log("✅ All required indexes already exist");
    }
  } catch (error) {
    console.error("Error checking/creating indexes:", error);
    // Don't throw error - continue with save operation even if index creation fails
  }
}

// ===== DISPLAY EXAMPLE VALUES =====

function displayNodeExamples(container, examples, nodeLabel) {
  if (!examples || examples.length === 0) {
    container.innerHTML = `<div class="no-examples">No example nodes found for ${nodeLabel}</div>`;
    return;
  }

  let html = "";
  examples.forEach((record, index) => {
    const nodeProperties = record.n || record;
    const properties = Object.entries(nodeProperties)
      .slice(0, 5)
      .map(
        ([key, value]) =>
          `<span class="example-key">${key}:</span> <span class="example-value">${truncateValue(
            value
          )}</span>`
      )
      .join("<br>");

    html += `
                    <div class="example-item">
                        <strong>Node ${index + 1}:</strong><br>
                        ${properties}
                        ${
                          Object.keys(nodeProperties).length > 5
                            ? "<br><em>... and more properties</em>"
                            : ""
                        }
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

  const uniqueValues = [...new Set(examples.map((e) => e.value))].slice(0, 10);
  const tags = uniqueValues
    .map((value) => `<span class="example-tag">${truncateValue(value)}</span>`)
    .join("");

  container.innerHTML = tags;
}

function displayRelationshipExamples(container, examples) {
  if (!examples || examples.length === 0) {
    container.innerHTML = `<span class="no-examples">No example relationships found</span>`;
    return;
  }

  const tags = examples
    .map(
      (rel) =>
        `<span class="example-tag">${rel.source_name || "N/A"} → ${
          rel.target_name || rel.target_label || "N/A"
        }</span>`
    )
    .join("");

  container.innerHTML = tags;
}

function showConnectionWarning(container, action = "This action") {
  container.innerHTML = `<div class="connection-warning">⚠️ No Neo4j connection. Please test connection first before attempting: ${action}.</div>`;
  if (container.style) container.style.display = "block";
}

function truncateValue(value, maxLength = 50) {
  const str = String(value);
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;
  localSchemaFilePath = file.name;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      let loadedData = JSON.parse(e.target.result);

      if (typeof loadedData.version !== "number") {
        loadedData.version = 1;
        isModified = true;
      }
      if (typeof loadedData.timestamp !== "string") {
        loadedData.timestamp = new Date().toISOString();
        isModified = true;
      }

      schemaData = loadedData;
      dbSchemaInfo = null;

      renderTreeView();
      updateStats();
      updateSchemaInfoDisplay(
        "JSON File",
        schemaData.version,
        schemaData.timestamp
      );

      document.getElementById("downloadBtn").disabled = false;
      document.getElementById("cypherBtn").disabled = false;
      document.getElementById("saveToDbBtn").disabled = true;
      if (neo4jConfig.connected) {
        document.getElementById("compareBtn").disabled = false;
      }
      document.getElementById("statsBar").style.display = "flex";
      document.getElementById("comparisonResults").style.display = "none";
      document.getElementById("comparisonText").textContent =
        "No comparison performed yet.";
      updateModifiedStatus(isModified);
    } catch (error) {
      alert("Error loading JSON file: " + error.message);
    }
  };
  reader.readAsText(file);
}

function updateSchemaInfoDisplay(source, version, timestamp, suffix = "") {
  document.getElementById("currentSchemaInfo").style.display = "block";
  document.getElementById("schemaSource").textContent = source + suffix;
  document.getElementById("schemaVersion").textContent =
    version !== undefined ? version : "N/A";
  document.getElementById("schemaTimestamp").textContent = timestamp || "N/A";
}

function renderTreeView() {
  const container = document.getElementById("treeContainer");
  container.innerHTML = "";

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
  const div = document.createElement("div");
  div.className = "node-item";

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

  document
    .querySelectorAll(".node-header")
    .forEach((h) => h.classList.remove("active"));
  document.querySelectorAll(".node-header")[index].classList.add("active");

  renderNodeDetails(schemaData.node_types[index]);
  // Default to showing Node Properties tab
  if (document.getElementById("tabButtonNodeProperties")) {
    openTab(null, "NodeProperties");
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
  } else {
    // For programmatic tab opening
    // Try to find the button by a conventional ID if event is null
    const btn = document.getElementById(`tabButton${tabName}`);
    if (btn) btn.classList.add("active");
  }
}

function renderNodeDetails(node) {
  const container = document.getElementById("detailsContainer");
  container.innerHTML = ""; // Clear previous content

  // Create Tab Buttons
  const tabContainer = document.createElement("div");
  tabContainer.className = "tab-container";
  tabContainer.innerHTML = `
                <button class="tab-button active" id="tabButtonNodeProperties" onclick="openTab(event, 'NodeProperties')">Node Properties</button>
                <button class="tab-button" id="tabButtonNodeRelations" onclick="openTab(event, 'NodeRelations')">Relationships</button>
            `;
  container.appendChild(tabContainer);

  // Create Tab Content Divs
  const nodePropsContent = document.createElement("div");
  nodePropsContent.id = "NodeProperties";
  nodePropsContent.className = "tab-content active"; // Active by default
  container.appendChild(nodePropsContent);

  const nodeRelationsContent = document.createElement("div");
  nodeRelationsContent.id = "NodeRelations";
  nodeRelationsContent.className = "tab-content";
  container.appendChild(nodeRelationsContent);

  // Populate Node Properties Tab
  let attributesHtml = "";
  Object.entries(node.attributes || {}).forEach(([name, attr]) => {
    attributesHtml += `
                    <div class="attribute-item">
                        <div class="attribute-name">${name}</div>
                        <div class="attribute-details">
                            <span>Type: ${attr.type}</span>
                            <span>Indexed: ${attr.indexed ? "Yes" : "No"}</span>
                            ${attr.unique ? `<span>Unique: Yes</span>` : ""}
                        </div>
                        <textarea class="form-control" placeholder="Attribute description..."
                                  onchange="updateAttributeDescription('${name}', this.value)"
                                  style="margin-top: 8px; min-height: 60px;">${
                                    attr.description || ""
                                  }</textarea>
                        
                        <div class="attribute-examples">
                            <div class="examples-title">
                                <span>Example Values:</span>
                                <button class="btn btn-info btn-small" onclick="loadAttributeExamples('${
                                  node.label
                                }', '${name}')">
                                    📊 Load Examples
                                </button>
                            </div>
                            <div id="examples-${
                              node.label
                            }-${name}" class="example-values">
                                <span class="no-examples">Click "Load Examples"</span>
                            </div>
                        </div>
                    </div>
                `;
  });

  nodePropsContent.innerHTML = `
                <div class="form-group">
                    <label class="form-label">🏷️ Node Label</label>
                    <input type="text" class="form-control" value="${
                      node.label
                    }" readonly>
                </div>
                
                <div class="form-group">
                    <label class="form-label">📝 Node Description</label>
                    <textarea class="form-control" placeholder="Node description..."
                              onchange="updateNodeDescription(this.value)">${
                                node.description || ""
                              }</textarea>
                </div>

                <div class="examples-section">
                    <div class="examples-header">
                        <h4>📊 Example Nodes</h4>
                        <div class="examples-controls">
                            <span>Limit:</span>
                            <input type="number" class="limit-input" id="nodeExampleLimit" value="10" min="1" max="100">
                            <button class="btn btn-info btn-small" onclick="loadNodeExamples('${
                              node.label
                            }')">
                                🔍 Load Nodes
                            </button>
                        </div>
                    </div>
                    <div id="nodeExamples-${
                      node.label
                    }" class="examples-container" style="display: none;">
                        <!-- Example nodes will be displayed here -->
                    </div>
                </div>

                <div class="attributes-section">
                    <div class="section-title">
                        🔧 Node Attributes (${
                          Object.keys(node.attributes || {}).length
                        })
                    </div>
                    ${attributesHtml}
                </div>
            `;

  // Populate Relationships Tab
  let relationshipsHtml = "";
  Object.entries(node.relationships || {}).forEach(([name, rel]) => {
    // Ensure rel.properties is an object
    rel.properties = rel.properties || {};
    let relPropertiesHtml = "";
    Object.entries(rel.properties).forEach(([propName, propDetails]) => {
      relPropertiesHtml += `
                        <div class="relationship-property-item">
                            <div class="relationship-property-name">${propName} (Type: ${
        propDetails.type || "string"
      })</div>
                            <textarea class="form-control" placeholder="Property description..."
                                      onchange="updateRelationshipPropertyDescription('${name}', '${propName}', this.value)"
                                      style="margin-top: 4px; font-size: 12px; min-height: 40px;">${
                                        propDetails.description || ""
                                      }</textarea>
                        </div>
                    `;
    });

    relationshipsHtml += `
                    <div class="relationship-item">
                        <div class="relationship-name">${name}</div>
                        <div class="relationship-details">
                            <span>Target: ${rel.target || "Not defined"}</span>
                        </div>
                        <textarea class="form-control" placeholder="Relationship description..."
                                  onchange="updateRelationshipDescription('${name}', this.value)"
                                  style="margin-top: 8px; min-height: 60px;">${
                                    rel.description || ""
                                  }</textarea>
                        
                        <div class="relationship-properties-section">
                            <div class="section-title" style="font-size: 13px; margin-bottom: 8px;">
                                🔩 Relationship Properties (${
                                  Object.keys(rel.properties).length
                                })
                                <button class="btn btn-success btn-small" onclick="addRelationshipProperty('${name}')">+ Add Property</button>
                            </div>
                            <div id="rel-props-${node.label}-${name}">
                                ${relPropertiesHtml}
                                ${
                                  Object.keys(rel.properties).length === 0
                                    ? '<p style="font-size:12px; color:#6c757d;">No properties defined for this relationship.</p>'
                                    : ""
                                }
                            </div>
                        </div>

                        <div class="relationship-examples">
                            <div class="examples-title">
                                <span>Example Relationships:</span>
                                <button class="btn btn-info btn-small" onclick="loadRelationshipExamples('${
                                  node.label
                                }', '${name}', '${rel.target || ""}')">
                                    🔗 Load Examples
                                </button>
                            </div>
                            <div id="rel-examples-${
                              node.label
                            }-${name}" class="example-values">
                                <span class="no-examples">Click "Load Examples"</span>
                            </div>
                        </div>
                    </div>
                `;
  });

  nodeRelationsContent.innerHTML = `
                <div class="relationships-section" style="margin-top:0; padding-top:0; border-top:none;">
                    <div class="section-title">
                        🔗 Relationships (${
                          Object.keys(node.relationships || {}).length
                        })
                    </div>
                    ${relationshipsHtml}
                </div>
            `;
  // Default to showing Node Properties tab
  openTab(null, "NodeProperties");
}

function updateNodeDescription(description) {
  if (currentNode === null || !schemaData) return;
  schemaData.node_types[currentNode].description = description;
  updateModifiedStatus(true);
}

function updateAttributeDescription(attrName, description) {
  if (currentNode === null || !schemaData) return;
  schemaData.node_types[currentNode].attributes[attrName].description =
    description;
  updateModifiedStatus(true);
}

function updateRelationshipDescription(relName, description) {
  if (currentNode === null || !schemaData) return;
  schemaData.node_types[currentNode].relationships[relName].description =
    description;
  updateModifiedStatus(true);
}

function addRelationshipProperty(relName) {
  if (currentNode === null || !schemaData) return;
  const node = schemaData.node_types[currentNode];
  if (!node.relationships[relName]) return;

  const newPropName = prompt("Enter new relationship property name:");
  if (
    !newPropName ||
    typeof newPropName !== "string" ||
    newPropName.trim() === ""
  ) {
    alert("Invalid property name.");
    return;
  }
  if (
    node.relationships[relName].properties &&
    node.relationships[relName].properties[newPropName.trim()]
  ) {
    alert(
      `Property "${newPropName.trim()}" already exists for this relationship.`
    );
    return;
  }

  const newPropType = prompt(
    "Enter property type (e.g., string, integer, boolean, date):",
    "string"
  );
  if (!newPropType) return; // User cancelled

  if (!node.relationships[relName].properties) {
    node.relationships[relName].properties = {};
  }
  node.relationships[relName].properties[newPropName.trim()] = {
    type: newPropType.trim(),
    description: "",
  };
  updateModifiedStatus(true);
  renderNodeDetails(node); // Re-render to show the new property input
  openTab(null, "NodeRelations"); // Switch to relations tab
}

function updateRelationshipPropertyDescription(relName, propName, description) {
  if (currentNode === null || !schemaData) return;
  const node = schemaData.node_types[currentNode];
  if (
    node &&
    node.relationships &&
    node.relationships[relName] &&
    node.relationships[relName].properties &&
    node.relationships[relName].properties[propName]
  ) {
    node.relationships[relName].properties[propName].description = description;
    updateModifiedStatus(true);
  }
}

function updateStats() {
  if (!schemaData || !schemaData.node_types) return;
  document.getElementById(
    "nodeCount"
  ).textContent = `${schemaData.node_types.length} Nodes`;
}

function filterNodes(event) {
  const searchTerm = event.target.value.toLowerCase();
  const nodes = document.querySelectorAll(".node-item");
  const detailsContainer = document.getElementById("detailsContainer");

  let firstMatchIndex = -1;

  nodes.forEach((nodeItem, index) => {
    const labelElement = nodeItem.querySelector(".node-label");
    const nodeData = schemaData.node_types[index];
    let match = false;

    if (labelElement.textContent.toLowerCase().includes(searchTerm)) {
      match = true;
    }

    if (!match && nodeData.attributes) {
      for (const attrName in nodeData.attributes) {
        if (
          attrName.toLowerCase().includes(searchTerm) ||
          (nodeData.attributes[attrName].description &&
            nodeData.attributes[attrName].description
              .toLowerCase()
              .includes(searchTerm))
        ) {
          match = true;
          break;
        }
      }
    }

    if (!match && nodeData.relationships) {
      for (const relName in nodeData.relationships) {
        if (
          relName.toLowerCase().includes(searchTerm) ||
          (nodeData.relationships[relName].description &&
            nodeData.relationships[relName].description
              .toLowerCase()
              .includes(searchTerm)) ||
          (nodeData.relationships[relName].target &&
            nodeData.relationships[relName].target
              .toLowerCase()
              .includes(searchTerm))
        ) {
          match = true;
          // Check relationship properties
          if (nodeData.relationships[relName].properties) {
            for (const relPropName in nodeData.relationships[relName]
              .properties) {
              if (
                relPropName.toLowerCase().includes(searchTerm) ||
                (nodeData.relationships[relName].properties[relPropName]
                  .description &&
                  nodeData.relationships[relName].properties[
                    relPropName
                  ].description
                    .toLowerCase()
                    .includes(searchTerm))
              ) {
                match = true;
                break;
              }
            }
          }
        }
        if (match) break;
      }
    }

    if (match) {
      nodeItem.style.display = "";
      if (firstMatchIndex === -1) {
        firstMatchIndex = index;
      }
    } else {
      nodeItem.style.display = "none";
    }
  });

  // If there's a match and no node is currently selected, or selected is hidden, select the first match
  if (firstMatchIndex !== -1) {
    const currentSelectedNodeItem = document.querySelector(
      ".node-header.active"
    );
    if (
      !currentSelectedNodeItem ||
      currentSelectedNodeItem.closest(".node-item").style.display === "none"
    ) {
      selectNode(firstMatchIndex);
    }
  } else if (searchTerm) {
    detailsContainer.innerHTML = `<div class="no-selection"><p>No matches found for "${searchTerm}"</p></div>`;
  } else if (!document.querySelector(".node-header.active")) {
    detailsContainer.innerHTML = `<div class="no-selection"><p>Select a node to edit</p></div>`;
  }
}

function downloadSchema() {
  if (!schemaData) {
    alert("No schema to download.");
    return;
  }
  if (!schemaData.version) schemaData.version = 0;
  schemaData.version += 1;
  schemaData.timestamp = new Date().toISOString();
  updateSchemaInfoDisplay(
    "JSON File (Saved)",
    schemaData.version,
    schemaData.timestamp
  );
  updateModifiedStatus(false); // Mark as unmodified after saving

  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(schemaData, null, 2));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  const fileName = localSchemaFilePath
    ? localSchemaFilePath.replace(/\.json$/i, "") +
      `_v${schemaData.version}.json`
    : `schema_v${schemaData.version}.json`;
  downloadAnchorNode.setAttribute("download", fileName);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

function exportToCypher() {
  if (!schemaData) {
    alert("No schema to export.");
    return;
  }

  let cypherCommands = [];
  const currentTimestamp = new Date().toISOString();

  if (typeof schemaData.version !== "number" || schemaData.version < 1) {
    schemaData.version = 1;
  }
  if (typeof schemaData.timestamp !== "string") {
    schemaData.timestamp = currentTimestamp;
  }

  let schemaJsonStringForCypherExport = JSON.stringify(schemaData, null, 2);
  schemaJsonStringForCypherExport = schemaJsonStringForCypherExport
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

  const schemaMetadataCypherCommand = `
// --- migRaven Schema Metadata (Version: ${schemaData.version}, Timestamp: ${schemaData.timestamp}) ---
MERGE (s:_migRaven_Schema {metaId: '${GLOBAL_SCHEMA_META_ID}'})
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

  schemaData.node_types.forEach((node) => {
    cypherCommands.push(`\n// Schema for Node Label: ${node.label}`);
    let idAttribute = Object.keys(node.attributes).find(
      (attr) => attr.toLowerCase() === "id" || attr.toLowerCase() === "name"
    );
    if (idAttribute) {
      cypherCommands.push(
        `CREATE CONSTRAINT IF NOT EXISTS ON (n:${node.label}) ASSERT n.${idAttribute} IS UNIQUE;`
      );
    }

    Object.entries(node.attributes).forEach(([attrName, attrDetails]) => {
      if (attrDetails.indexed) {
        cypherCommands.push(
          `CREATE INDEX IF NOT EXISTS FOR (n:${node.label}) ON (n.${attrName});`
        );
      }
      if (attrDetails.unique && !(idAttribute && attrName === idAttribute)) {
        cypherCommands.push(
          `CREATE CONSTRAINT IF NOT EXISTS ON (n:${node.label}) ASSERT n.${attrName} IS UNIQUE;`
        );
      }
    });
  });

  lastCypherQueryForExport = cypherCommands.join("\n");
  document.getElementById("cypherPreview").value = lastCypherQueryForExport;
  document.getElementById("cypherModal").style.display = "block";
}

function closeCypherModal() {
  document.getElementById("cypherModal").style.display = "none";
}

function confirmCypherExport() {
  if (!lastCypherQueryForExport) {
    alert("No Cypher query generated.");
    return;
  }
  const dataStr =
    "data:application/vnd.neo4j.cypher;charset=utf-8," +
    encodeURIComponent(lastCypherQueryForExport);
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  const fileName = `migRaven_schema_export_v${
    schemaData.version || "1"
  }.cypher`;
  downloadAnchorNode.setAttribute("download", fileName);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  closeCypherModal();
} // ===== SAVE TO NEO4J =====
async function saveSchemaToNeo4j() {
  if (!schemaData) {
    alert("No local schema to save.");
    return;
  }
  if (!isModified) {
    let allowUnmodifiedSave = !dbSchemaInfo || !dbSchemaInfo.metaId;
    if (dbSchemaInfo && dbSchemaInfo.version !== schemaData.version) {
      allowUnmodifiedSave = true;
    }
    if (!allowUnmodifiedSave) {
      alert("No changes to save to the database.");
      return;
    }
  }
  if (!neo4jConfig.connected || !neo4jDriver) {
    alert("Not connected to Neo4j. Please test connection first.");
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
    "Local (Pending Save as _migRaven_Schema nodes)",
    schemaData.version,
    schemaData.timestamp
  );
  const statusDiv = document.getElementById("connectionStatus");
  statusDiv.style.display = "block";
  statusDiv.innerHTML = `<div class="connection-warning">🔄 Preparing schema save operation...</div>`;

  let originalVersionBeforeSaveAttempt = schemaData.version;

  try {
    // Ensure indexes exist for optimal performance
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 1/5: Ensuring database indexes for optimal performance...</div>`;
    await ensureMigRavenSchemaIndexes(); // Check for existing _migRaven_Schema nodes

    // Check for existing schema versions
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 2/5: Checking for existing schema versions...</div>`;
    const existingResult = await executeNeo4jQuery(
      `MATCH (n:_migRaven_Schema) 
       RETURN count(n) AS nodeCount, max(n.schemaVersion) AS maxVersion, max(n.timestamp) AS latestTimestamp`
    );

    // Determine if this is the first save or an update
    const isInitialSave =
      existingResult.length === 0 || existingResult[0].nodeCount === 0;

    let proceed = true;
    let dbSchema = null;

    if (!isInitialSave) {
      const dbVersion = existingResult[0].maxVersion;
      const dbTimestamp = existingResult[0].latestTimestamp;

      if (schemaData.version < dbVersion) {
        proceed = confirm(
          `WARNING: The schema in the database (Version: ${dbVersion}) is NEWER than your local schema (Version: ${schemaData.version}). Overwriting will result in data loss. Do you want to proceed?`
        );
      } else if (
        schemaData.version === dbVersion &&
        dbTimestamp &&
        schemaData.timestamp < dbTimestamp
      ) {
        proceed = confirm(
          `WARNING: The schema in the database has a more recent timestamp. This might indicate concurrent edits. Overwrite with your local changes?`
        );
      }

      if (!proceed) {
        statusDiv.innerHTML = `<div class="connection-warning">Save to DB cancelled by user.</div>`;
        if (
          isModified ||
          originalVersionBeforeSaveAttempt !== schemaData.version
        ) {
          schemaData.version = originalVersionBeforeSaveAttempt - 1;
          if (schemaData.version < 0) schemaData.version = 0;
        }
        updateSchemaInfoDisplay(
          "Local JSON (Save Cancelled)",
          schemaData.version,
          schemaData.timestamp
        );
        return;
      }

      // For updates, load the existing schema data from metadata node
      try {
        const metaResult = await executeNeo4jQuery(
          `MATCH (meta:_migRaven_Schema {nodeType: 'metadata'}) 
           RETURN meta.originalSchemaData AS originalSchemaData 
           ORDER BY meta.schemaVersion DESC, meta.timestamp DESC 
           LIMIT 1`
        );

        if (metaResult.length > 0 && metaResult[0].originalSchemaData) {
          dbSchema = JSON.parse(metaResult[0].originalSchemaData);
        }
      } catch (e) {
        console.warn(
          "Could not load schema data from database for comparison:",
          e
        );
      }
    }
    const timestamp = schemaData.timestamp;
    const version = schemaData.version;
    let migRavenNodes = new Map(); // Store created node IDs
    let diffResult; // Store differential update results

    if (isInitialSave || !dbSchema) {
      // For initial save or if we couldn't load the previous schema, clear all and create new
      statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 3/5: Initial save - clearing existing nodes...</div>`;
      await executeNeo4jQuery("MATCH (n:_migRaven_Schema) DETACH DELETE n");

      statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 4/5: Creating _migRaven_Schema nodes for ${schemaData.node_types.length} node types...</div>`;
      for (const nodeType of schemaData.node_types) {
        // Skip relationship pseudo-nodes (those with originalType)
        if (nodeType.originalType) continue;

        const properties = {};
        for (const [attrName, attrInfo] of Object.entries(
          nodeType.attributes || {}
        )) {
          properties[attrName] = {
            type: attrInfo.type || "string",
            indexed: attrInfo.indexed || false,
            unique: attrInfo.unique || false,
            description: attrInfo.description || `Property ${attrName}`,
          };
        }
        const createNodeQuery = `
                        CREATE (n:_migRaven_Schema {
                            originalLabel: $originalLabel,
                            nodeType: 'node',
                            description: $description,
                            properties: $properties,
                            createdAt: $timestamp,
                            schemaVersion: $schemaVersion,
                            timestamp: $timestamp
                        })
                        RETURN id(n) AS nodeId
                    `;

        const nodeResult = await executeNeo4jQuery(createNodeQuery, {
          originalLabel: nodeType.label,
          description: nodeType.description || `Node type ${nodeType.label}`,
          properties: JSON.stringify(properties),
          timestamp: timestamp,
          schemaVersion: version,
        });

        if (nodeResult.length > 0) {
          migRavenNodes.set(nodeType.label, nodeResult[0].nodeId);
        }
      }

      // Create relationships between _migRaven_Schema nodes
      for (const nodeType of schemaData.node_types) {
        // Skip relationship pseudo-nodes
        if (nodeType.originalType) continue;

        for (const [relName, relInfo] of Object.entries(
          nodeType.relationships || {}
        )) {
          const targetLabel = relInfo.target;

          if (
            migRavenNodes.has(nodeType.label) &&
            migRavenNodes.has(targetLabel)
          ) {
            const relProperties = {};
            for (const [propName, propInfo] of Object.entries(
              relInfo.properties || {}
            )) {
              relProperties[propName] = {
                type: propInfo.type || "string",
                description:
                  propInfo.description || `Relationship property ${propName}`,
              };
            }

            const createRelQuery = `
                                MATCH (source:_migRaven_Schema), (target:_migRaven_Schema)
                                WHERE id(source) = $sourceId AND id(target) = $targetId
                                CREATE (source)-[r:_SCHEMA_RELATIONSHIP {
                                    originalType: $originalType,
                                    properties: $properties,
                                    description: $description,
                                    createdAt: $timestamp,
                                    schemaVersion: $schemaVersion,
                                    timestamp: $timestamp
                                }]->(target)
                                RETURN r
                            `;
            await executeNeo4jQuery(createRelQuery, {
              sourceId: migRavenNodes.get(nodeType.label),
              targetId: migRavenNodes.get(targetLabel),
              originalType: relName,
              properties: JSON.stringify(relProperties),
              description: relInfo.description || `Relationship ${relName}`,
              timestamp: timestamp,
              schemaVersion: version,
            });
          }
        }
      }
    } else {
      // Differential update - only update what has changed
      statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 3/5: Comparing local schema with database schema...</div>`;

      // Get existing nodes from database for comparison
      const existingNodes = await executeNeo4jQuery(
        `MATCH (n:_migRaven_Schema {nodeType: 'node'}) 
         RETURN id(n) AS nodeId, n.originalLabel AS label, n.properties AS properties, n.description AS description`
      );

      // Create a map of existing nodes for quick lookup
      const existingNodesMap = new Map();
      existingNodes.forEach((node) => {
        existingNodesMap.set(node.label, {
          nodeId: node.nodeId,
          properties: JSON.parse(node.properties || "{}"),
          description: node.description,
        });
      });

      statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 4/5: Updating changed schema elements...</div>`;

      const migRavenNodes = new Map(); // Store node IDs for relationship creation
      let updatedNodes = 0;
      let newNodes = 0;
      let updatedRelationships = 0;
      let deletedNodes = 0;

      // Process node types - update existing or create new
      for (const nodeType of schemaData.node_types) {
        // Skip relationship pseudo-nodes
        if (nodeType.originalType) continue;

        const properties = {};
        for (const [attrName, attrInfo] of Object.entries(
          nodeType.attributes || {}
        )) {
          properties[attrName] = {
            type: attrInfo.type || "string",
            indexed: attrInfo.indexed || false,
            unique: attrInfo.unique || false,
            description: attrInfo.description || `Property ${attrName}`,
          };
        }

        const propertiesJson = JSON.stringify(properties);

        if (existingNodesMap.has(nodeType.label)) {
          // Node exists - check if it needs updating
          const existingNode = existingNodesMap.get(nodeType.label);
          const existingPropertiesJson = JSON.stringify(
            existingNode.properties
          );

          if (
            propertiesJson !== existingPropertiesJson ||
            nodeType.description !== existingNode.description
          ) {
            // Node properties or description changed - update it
            const updateNodeQuery = `
              MATCH (n:_migRaven_Schema) 
              WHERE id(n) = $nodeId
              SET n.properties = $properties,
                  n.description = $description,
                  n.timestamp = $timestamp,
                  n.schemaVersion = $schemaVersion,
                  n.updatedAt = $timestamp
              RETURN id(n) AS nodeId
            `;

            const result = await executeNeo4jQuery(updateNodeQuery, {
              nodeId: existingNode.nodeId,
              properties: propertiesJson,
              description:
                nodeType.description || `Node type ${nodeType.label}`,
              timestamp: timestamp,
              schemaVersion: version,
            });

            if (result.length > 0) {
              migRavenNodes.set(nodeType.label, result[0].nodeId);
              updatedNodes++;
            }
          } else {
            // Node unchanged - keep reference for relationships
            migRavenNodes.set(nodeType.label, existingNode.nodeId);
          }

          // Mark this node as processed
          existingNodesMap.delete(nodeType.label);
        } else {
          // Node does not exist - create new
          const createNodeQuery = `
            CREATE (n:_migRaven_Schema {
              originalLabel: $originalLabel,
              nodeType: 'node',
              description: $description,
              properties: $properties,
              createdAt: $timestamp,
              schemaVersion: $schemaVersion,
              timestamp: $timestamp
            })
            RETURN id(n) AS nodeId
          `;

          const result = await executeNeo4jQuery(createNodeQuery, {
            originalLabel: nodeType.label,
            description: nodeType.description || `Node type ${nodeType.label}`,
            properties: propertiesJson,
            timestamp: timestamp,
            schemaVersion: version,
          });

          if (result.length > 0) {
            migRavenNodes.set(nodeType.label, result[0].nodeId);
            newNodes++;
          }
        }
      }

      // Delete nodes that exist in DB but not in local schema
      if (existingNodesMap.size > 0) {
        const nodesToDelete = Array.from(existingNodesMap.keys());
        deletedNodes = nodesToDelete.length;

        for (const nodeLabel of nodesToDelete) {
          await executeNeo4jQuery(
            `MATCH (n:_migRaven_Schema {originalLabel: $label, nodeType: 'node'})
             DETACH DELETE n`,
            { label: nodeLabel }
          );
        }
      }

      // Get existing relationships from database for comparison
      const existingRelationships = await executeNeo4jQuery(
        `MATCH (source:_migRaven_Schema {nodeType: 'node'})-[r:_SCHEMA_RELATIONSHIP]->(target:_migRaven_Schema {nodeType: 'node'})
         RETURN id(r) AS relId, source.originalLabel AS sourceLabel, target.originalLabel AS targetLabel,
               r.originalType AS relType, r.properties AS properties, r.description AS description`
      );

      // Create a map of existing relationships for quick lookup
      const existingRelMap = new Map();
      existingRelationships.forEach((rel) => {
        const key = `${rel.sourceLabel}|${rel.relType}|${rel.targetLabel}`;
        existingRelMap.set(key, {
          relId: rel.relId,
          properties: JSON.parse(rel.properties || "{}"),
          description: rel.description,
        });
      });

      // Process relationships - update existing or create new
      for (const nodeType of schemaData.node_types) {
        // Skip relationship pseudo-nodes
        if (nodeType.originalType) continue;

        // Skip if source node not found
        if (!migRavenNodes.has(nodeType.label)) continue;

        for (const [relName, relInfo] of Object.entries(
          nodeType.relationships || {}
        )) {
          const targetLabel = relInfo.target;

          // Skip if target node not found
          if (!migRavenNodes.has(targetLabel)) continue;

          const relProperties = {};
          for (const [propName, propInfo] of Object.entries(
            relInfo.properties || {}
          )) {
            relProperties[propName] = {
              type: propInfo.type || "string",
              description:
                propInfo.description || `Relationship property ${propName}`,
            };
          }

          const relPropertiesJson = JSON.stringify(relProperties);
          const relKey = `${nodeType.label}|${relName}|${targetLabel}`;

          if (existingRelMap.has(relKey)) {
            // Relationship exists - check if it needs updating
            const existingRel = existingRelMap.get(relKey);
            const existingPropertiesJson = JSON.stringify(
              existingRel.properties
            );

            if (
              relPropertiesJson !== existingPropertiesJson ||
              relInfo.description !== existingRel.description
            ) {
              // Relationship changed - update it
              const updateRelQuery = `
                MATCH ()-[r]->() 
                WHERE id(r) = $relId
                SET r.properties = $properties,
                    r.description = $description,
                    r.timestamp = $timestamp,
                    r.schemaVersion = $schemaVersion,
                    r.updatedAt = $timestamp
              `;

              await executeNeo4jQuery(updateRelQuery, {
                relId: existingRel.relId,
                properties: relPropertiesJson,
                description: relInfo.description || `Relationship ${relName}`,
                timestamp: timestamp,
                schemaVersion: version,
              });

              updatedRelationships++;
            }

            // Mark this relationship as processed
            existingRelMap.delete(relKey);
          } else {
            // Relationship doesn't exist - create new
            const createRelQuery = `
              MATCH (source:_migRaven_Schema), (target:_migRaven_Schema)
              WHERE id(source) = $sourceId AND id(target) = $targetId
              CREATE (source)-[r:_SCHEMA_RELATIONSHIP {
                originalType: $originalType,
                properties: $properties,
                description: $description,
                createdAt: $timestamp,
                schemaVersion: $schemaVersion,
                timestamp: $timestamp
              }]->(target)
            `;

            await executeNeo4jQuery(createRelQuery, {
              sourceId: migRavenNodes.get(nodeType.label),
              targetId: migRavenNodes.get(targetLabel),
              originalType: relName,
              properties: relPropertiesJson,
              description: relInfo.description || `Relationship ${relName}`,
              timestamp: timestamp,
              schemaVersion: version,
            });
          }
        }
      } // Delete relationships that exist in DB but not in local schema
      let deletedRels = 0;
      if (existingRelMap.size > 0) {
        const relsToDelete = Array.from(existingRelMap.values()).map(
          (r) => r.relId
        );
        deletedRels = relsToDelete.length;

        for (const relId of relsToDelete) {
          await executeNeo4jQuery(
            `MATCH ()-[r]->() WHERE id(r) = $relId DELETE r`,
            { relId: relId }
          );
        }
      }

      // Update metadata node
      await executeNeo4jQuery(
        "MATCH (n:_migRaven_Schema {nodeType: 'metadata'}) DELETE n"
      );

      const updateStats = {
        newNodes,
        updatedNodes,
        deletedNodes,
        updatedRelationships,
        deletedRelationships: deletedRels,
        timestamp: timestamp,
      }; // Store update stats for display but continue with metadata creation
      const diffUpdateResult = {
        migRavenNodes,
        updateStats,
        nodeChanges: newNodes + updatedNodes + deletedNodes,
        relationshipChanges: updatedRelationships + deletedRels,
      }; // Continue with schema metadata creation...
      // Create the metadata node
      statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 5/5: Creating schema metadata with differential update stats...</div>`;

      // Create the metadata node with the original schema data and update stats
      const createMetaQuery = `
        CREATE (meta:_migRaven_Schema {
            nodeType: 'metadata',
            schemaVersion: $schemaVersion,
            timestamp: $timestamp,
            createdAt: $timestamp,
            totalNodes: $totalNodes,
            totalRelationships: $totalRelationships,
            originalSchemaData: $originalSchemaData,
            updateStats: $updateStats,
            schemaId: $schemaId
        })
      `;

      await executeNeo4jQuery(createMetaQuery, {
        schemaVersion: version,
        timestamp: timestamp,
        totalNodes: migRavenNodes.size,
        totalRelationships: 0, // This will be updated after relationship count
        originalSchemaData: JSON.stringify(schemaData),
        updateStats: JSON.stringify(updateStats || {}),
        schemaId: GLOBAL_SCHEMA_META_ID,
      });

      // Count actual relationships created (they might differ from the schema if some nodes were missing)
      const relCountResult = await executeNeo4jQuery(
        `MATCH (:_migRaven_Schema)-[r:_SCHEMA_RELATIONSHIP]->(:_migRaven_Schema) RETURN count(r) as relCount`
      );

      if (relCountResult.length > 0) {
        await executeNeo4jQuery(
          `MATCH (meta:_migRaven_Schema {nodeType: 'metadata', schemaVersion: $version})
           SET meta.totalRelationships = $relCount`,
          { version: version, relCount: relCountResult[0].relCount }
        );
      }

      // Update success message with stats
      let successMsg = `✅ Schema saved to database as _migRaven_Schema nodes (Version ${version})`;

      if (updateStats) {
        successMsg += `<br>📊 Stats: ${updateStats.newNodes} new nodes, ${updateStats.updatedNodes} updated nodes, ${updateStats.deletedNodes} deleted nodes`;
        successMsg += `<br>📊 Relationships: ${updateStats.updatedRelationships} updated, ${updateStats.deletedRelationships} deleted`;
      }

      statusDiv.innerHTML = `<div class="connection-success">${successMsg}</div>`;
      // Update local status
      dbSchemaInfo = {
        version: version,
        timestamp: timestamp,
        metaId: GLOBAL_SCHEMA_META_ID,
      };

      updateModifiedStatus(false);
      updateSchemaInfoDisplay(
        "Neo4j DB (_migRaven_Schema)",
        version,
        timestamp
      );
    } // Close the else block for differential vs initial save
  } catch (error) {
    console.error("Error saving schema as _migRaven_Schema nodes:", error);
    statusDiv.innerHTML = `<div class="connection-error">❌ Error saving schema: ${error.message}</div>`;
    if (isModified || originalVersionBeforeSaveAttempt !== schemaData.version) {
      schemaData.version = originalVersionBeforeSaveAttempt - 1;
      if (schemaData.version < 0) schemaData.version = 0;
    }
    updateSchemaInfoDisplay(
      "Local JSON (Save Failed)",
      schemaData.version,
      schemaData.timestamp
    );
  }
}

async function compareWithDbSchema() {
  if (!schemaData) {
    alert("Load a local schema first to compare.");
    return;
  }
  if (!neo4jConfig.connected || !neo4jDriver) {
    alert("Not connected to Neo4j. Please test connection first.");
    return;
  }

  const comparisonDiv = document.getElementById("comparisonResults");
  const comparisonText = document.getElementById("comparisonText");
  comparisonDiv.style.display = "block";
  comparisonText.innerHTML =
    "🔄 Fetching database schema from _migRaven_Schema nodes...";

  try {
    // Load schema from _migRaven_Schema nodes for comparison
    const metaResult = await executeNeo4jQuery(
      `MATCH (meta:_migRaven_Schema {nodeType: 'metadata'}) 
                     RETURN meta.schemaVersion AS version, meta.timestamp AS timestamp, 
                            meta.totalNodes AS totalNodes, meta.totalRelationships AS totalRelationships,
                            meta.indexes AS indexes, meta.constraints AS constraints,
                            meta.originalSchemaData AS originalSchemaData
                     ORDER BY meta.schemaVersion DESC, meta.timestamp DESC 
                     LIMIT 1`
    );

    if (metaResult.length === 0) {
      comparisonText.innerHTML = `⚠️ No _migRaven_Schema nodes found in database. You can save the current local schema to the database using "Save to DB".`;
      dbSchemaInfo = null;
      updateSchemaInfoDisplay(
        document.getElementById("schemaSource").textContent.startsWith("JSON")
          ? "JSON File"
          : document.getElementById("schemaSource").textContent,
        schemaData.version,
        schemaData.timestamp,
        " (DB schema not found)"
      );
      return;
    }

    const meta = metaResult[0];

    // Load the original schema data if available for detailed comparison
    let dbSchema = null;
    if (meta.originalSchemaData) {
      try {
        dbSchema = JSON.parse(meta.originalSchemaData);
      } catch (e) {
        console.warn(
          "Could not parse original schema data, will reconstruct from _migRaven_Schema nodes"
        );
      }
    } // If no original schema data or parsing failed, reconstruct from _migRaven_Schema nodes
    if (!dbSchema) {
      // Reconstruct schema from _migRaven_Schema nodes
      const nodeResults = await executeNeo4jQuery(
        `MATCH (n:_migRaven_Schema) 
                         WHERE n.nodeType = 'node_label' 
                         RETURN n.originalLabel AS label, n.properties AS properties, n.description AS description
                         ORDER BY n.originalLabel`
      );

      const relationshipResults = await executeNeo4jQuery(
        `MATCH (source:_migRaven_Schema)-[r:_SCHEMA_RELATIONSHIP]->(target:_migRaven_Schema)
                         WHERE source.nodeType = 'node_label' AND target.nodeType = 'node_label'
                         RETURN source.originalLabel AS sourceLabel, target.originalLabel AS targetLabel,
                                r.originalType AS relType, r.properties AS relProperties, r.description AS description`
      );

      dbSchema = {
        version: meta.version,
        timestamp: meta.timestamp,
        description: "Schema reconstructed from _migRaven_Schema nodes",
        node_types: [],
        indexes: meta.indexes ? JSON.parse(meta.indexes) : [],
        constraints: meta.constraints ? JSON.parse(meta.constraints) : [],
      };

      // Build node types from _migRaven_Schema nodes
      for (const node of nodeResults) {
        const nodeType = {
          label: node.label,
          description: node.description || `Node type ${node.label}`,
          attributes: {},
          relationships: {},
        };

        // Parse properties
        if (node.properties) {
          try {
            const props = JSON.parse(node.properties);
            for (const [propName, propData] of Object.entries(props)) {
              nodeType.attributes[propName] = {
                type: propData.type || "string",
                description: propData.description || `Property ${propName}`,
              };
            }
          } catch (e) {
            console.warn(
              `Could not parse properties for node ${node.label}:`,
              e
            );
          }
        }

        dbSchema.node_types.push(nodeType);
      }

      // Add relationships to node types
      for (const rel of relationshipResults) {
        const sourceNode = dbSchema.node_types.find(
          (n) => n.label === rel.sourceLabel
        );
        if (sourceNode) {
          const relKey = `${rel.relType}_${rel.targetLabel}`;
          sourceNode.relationships[relKey] = {
            name: rel.relType,
            target_node: rel.targetLabel,
            description:
              rel.description ||
              `Relationship ${rel.relType} to ${rel.targetLabel}`,
            properties: rel.relProperties ? JSON.parse(rel.relProperties) : {},
          };
        }
      }
    }

    // Store DB schema info for reference
    dbSchemaInfo = {
      version: meta.version,
      timestamp: meta.timestamp,
      totalNodes: meta.totalNodes,
      totalRelationships: meta.totalRelationships,
      source: "_migRaven_Schema_nodes",
    };

    updateSchemaInfoDisplay(
      `Database (_migRaven_Schema nodes, v${dbSchemaInfo.version})`,
      dbSchemaInfo.version,
      dbSchemaInfo.timestamp
    );

    // Use SchemaComparator for detailed comparison
    if (typeof SchemaComparator !== "undefined") {
      const comparator = new SchemaComparator();
      const comparisonResults = comparator.compare(schemaData, dbSchema, {
        schema1: "Local Schema",
        schema2: "Database Schema (_migRaven_Schema)",
      });

      // Generate detailed HTML report
      const htmlReport = comparator.generateHtmlReport(comparisonResults);
      comparisonText.innerHTML = htmlReport;
    } else {
      // Fallback to simple comparison
      let differences = [];

      // Version comparison
      if (schemaData.version > dbSchema.version) {
        differences.push(
          `Local schema version (${schemaData.version}) is newer than DB version (${dbSchema.version}).`
        );
      } else if (schemaData.version < dbSchema.version) {
        differences.push(
          `<strong>Warning:</strong> DB schema version (${dbSchema.version}) is newer than local version (${schemaData.version}). Consider reloading from DB.`
        );
      }

      // Timestamp comparison
      if (schemaData.timestamp && dbSchema.timestamp) {
        if (new Date(schemaData.timestamp) > new Date(dbSchema.timestamp)) {
          differences.push(
            `Local schema has a more recent timestamp (${schemaData.timestamp}) than DB schema (${dbSchema.timestamp}).`
          );
        } else if (
          new Date(schemaData.timestamp) < new Date(dbSchema.timestamp)
        ) {
          differences.push(
            `<strong>Warning:</strong> DB schema has a more recent timestamp (${dbSchema.timestamp}) than local schema (${schemaData.timestamp}).`
          );
        }
      }

      // Node label comparison
      const localNodeLabels = new Set(
        schemaData.node_types.map((nt) => nt.label)
      );
      const dbNodeLabels = new Set(dbSchema.node_types.map((nt) => nt.label));

      localNodeLabels.forEach((label) => {
        if (!dbNodeLabels.has(label))
          differences.push(
            `Node type "${label}" exists locally but not in DB schema.`
          );
      });
      dbNodeLabels.forEach((label) => {
        if (!localNodeLabels.has(label))
          differences.push(
            `Node type "${label}" exists in DB schema but not locally.`
          );
      });

      // Summary
      if (differences.length === 0) {
        comparisonText.innerHTML =
          "✅ Local schema and database schema appear to be in sync (based on version, timestamp, and node labels).";
      } else {
        comparisonText.innerHTML =
          "<strong>Differences found:</strong><ul><li>" +
          differences.join("</li><li>") +
          "</li></ul>";
      }
    }
  } catch (error) {
    console.error("Error comparing with DB schema:", error);
    comparisonText.innerHTML = `❌ Error comparing with DB schema: ${error.message}`;
    updateSchemaInfoDisplay(
      document.getElementById("schemaSource").textContent.startsWith("JSON")
        ? "JSON File"
        : document.getElementById("schemaSource").textContent,
      schemaData.version,
      schemaData.timestamp,
      " (DB comparison failed)"
    );
  }
}
async function loadSchemaFromNeo4j() {
  if (!neo4jConfig.connected || !neo4jDriver) {
    alert("Not connected to Neo4j. Please test connection first.");
    return;
  }

  const statusDiv = document.getElementById("connectionStatus");
  statusDiv.style.display = "block";
  statusDiv.innerHTML = `<div class="connection-warning">🔄 Loading complete schema from _migRaven_Schema nodes...</div>`;

  const comparisonDiv = document.getElementById("comparisonResults");
  const comparisonText = document.getElementById("comparisonText");
  comparisonDiv.style.display = "none";
  comparisonText.innerHTML = "No comparison performed yet.";

  try {
    // 1. Check if _migRaven_Schema nodes exist and get latest version
    const checkResult = await executeNeo4jQuery(
      `MATCH (n:_migRaven_Schema) 
                     RETURN count(n) AS nodeCount, 
                            max(n.schemaVersion) AS latestVersion,
                            max(n.timestamp) AS latestTimestamp`
    );

    if (checkResult.length === 0 || checkResult[0].nodeCount === 0) {
      statusDiv.innerHTML = `<div class="connection-error">❌ No _migRaven_Schema nodes found in database.</div>`;
      alert(
        'No _migRaven_Schema nodes found in database. Use "Generate Schema from DB" first to create the schema nodes.'
      );
      return;
    }

    const latestVersion = checkResult[0].latestVersion || 1;
    const latestTimestamp = checkResult[0].latestTimestamp;

    // 2. Load metadata
    const metaResult = await executeNeo4jQuery(
      `MATCH (meta:_migRaven_Schema {nodeType: 'metadata'}) 
                     WHERE meta.schemaVersion = $version
                     RETURN meta.description AS description, 
                            meta.indexes AS indexes, 
                            meta.constraints AS constraints,
                            meta.totalNodes AS totalNodes,
                            meta.totalRelationships AS totalRelationships`,
      { version: latestVersion }
    );

    let indexes = [];
    let constraints = [];
    let description = `Complete schema loaded from _migRaven_Schema nodes (version ${latestVersion})`;
    let totalNodes = 0;
    let totalRelationships = 0;

    if (metaResult.length > 0) {
      try {
        indexes = JSON.parse(metaResult[0].indexes || "[]");
        constraints = JSON.parse(metaResult[0].constraints || "[]");
        description = metaResult[0].description || description;
        totalNodes = metaResult[0].totalNodes || 0;
        totalRelationships = metaResult[0].totalRelationships || 0;
      } catch (e) {
        console.warn("Error parsing metadata:", e);
      }
    } // 3. Load all node types from _migRaven_Schema nodes
    const nodeResult = await executeNeo4jQuery(
      `MATCH (n:_migRaven_Schema {nodeType: 'node'}) 
                     WHERE n.schemaVersion = $version
                     RETURN n.originalLabel AS label, 
                            n.description AS description, 
                            n.properties AS properties
                     ORDER BY n.originalLabel`,
      { version: latestVersion }
    );

    const nodeTypes = [];
    for (const node of nodeResult) {
      let properties = {};
      try {
        properties = JSON.parse(node.properties || "{}");
      } catch (e) {
        console.warn(`Error parsing properties for node ${node.label}:`, e);
      }

      // Convert properties format to UI format
      const attributes = {};
      for (const [propName, propInfo] of Object.entries(properties)) {
        attributes[propName] = {
          type: propInfo.type || "string",
          indexed: propInfo.indexed || false,
          unique: propInfo.unique || false,
          description: propInfo.description || `Property ${propName}`,
        };
      }

      nodeTypes.push({
        label: node.label,
        description: node.description || `Node type ${node.label}`,
        attributes: attributes,
        relationships: {},
      });
    }

    // 4. Load all relationships and add them to appropriate node types
    const relResult = await executeNeo4jQuery(
      `MATCH (source:_migRaven_Schema {nodeType: 'node'})-[r:_SCHEMA_RELATIONSHIP]->(target:_migRaven_Schema {nodeType: 'node'})
                     WHERE r.schemaVersion = $version
                     RETURN source.originalLabel AS sourceLabel, target.originalLabel AS targetLabel,
                            r.originalType AS relType,
                            r.description AS description,
                            r.properties AS properties
                     ORDER BY source.originalLabel, r.originalType`,
      { version: latestVersion }
    );

    // Group relationships by source node and add to node types
    for (const rel of relResult) {
      const sourceNode = nodeTypes.find((n) => n.label === rel.sourceLabel);
      if (sourceNode) {
        const relKey = `${rel.relType}_${rel.targetLabel}`;
        sourceNode.relationships[relKey] = {
          name: rel.relType,
          target_node: rel.targetLabel,
          description:
            rel.description ||
            `Relationship ${rel.relType} to ${rel.targetLabel}`,
          properties: rel.relProperties ? JSON.parse(rel.relProperties) : {},
        };
      }
    }

    // 5. Create schema object
    const loadedSchema = {
      version: latestVersion,
      timestamp: latestTimestamp || new Date().toISOString(),
      description: description,
      node_types: nodeTypes,
      indexes: indexes,
      constraints: constraints,
    };

    // 6. Update UI and application state
    schemaData = loadedSchema;
    localSchemaFilePath = null;
    isModified = false;
    dbSchemaInfo = {
      version: latestVersion,
      timestamp: latestTimestamp,
      metaId: "_migRaven_Schema_Loaded",
      totalNodes: totalNodes,
      totalRelationships: totalRelationships,
    };

    renderTreeView();
    updateStats();
    updateSchemaInfoDisplay(
      `Database (_migRaven_Schema, loaded at ${new Date().toLocaleString()})`,
      dbSchemaInfo.version,
      dbSchemaInfo.timestamp
    );

    // Enable/disable buttons appropriately
    document.getElementById("downloadBtn").disabled = false;
    document.getElementById("cypherBtn").disabled = false;
    document.getElementById("saveToDbBtn").disabled = true; // No modifications yet
    document.getElementById("compareBtn").disabled = false;
    document.getElementById("statsBar").style.display = "flex";

    statusDiv.innerHTML = `<div class="connection-success">✅ Complete schema successfully loaded from _migRaven_Schema nodes (${
      nodeTypes.length
    } node types, ${Object.values(nodeTypes).reduce(
      (sum, nt) => sum + Object.keys(nt.relationships).length,
      0
    )} relationships, ${Object.values(nodeTypes).reduce(
      (sum, nt) => sum + Object.keys(nt.attributes).length,
      0
    )} total properties).</div>`;
    updateModifiedStatus(false);

    // Select first node if available
    if (nodeTypes.length > 0) {
      selectNode(0);
    }
  } catch (error) {
    console.error("Error loading schema from _migRaven_Schema nodes:", error);
    statusDiv.innerHTML = `<div class="connection-error">❌ Error loading schema: ${error.message}</div>`;
    alert(`Error loading schema from _migRaven_Schema nodes: ${error.message}`);
  }
}

async function generateSchemaFromDb() {
  if (!neo4jConfig.connected || !neo4jDriver) {
    alert("Not connected to Neo4j. Please test connection first.");
    return;
  }
  const statusDiv = document.getElementById("connectionStatus");
  statusDiv.style.display = "block";
  statusDiv.innerHTML = `<div class="connection-warning">🔄 Generating complete schema from database using db.schema.visualization()... This may take a while.</div>`;

  try {
    // 0. Ensure indexes exist for optimal performance
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 0/6: Ensuring database indexes for optimal performance...</div>`;
    await ensureMigRavenSchemaIndexes();

    // 1. Get schema visualization (the main schema query as requested)
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 1/6: Reading schema visualization...</div>`;
    const schemaVis = await executeNeo4jQuery("CALL db.schema.visualization()");

    // Extract nodes, relationships from visualization
    const visNodes = schemaVis.flatMap((record) => record.nodes || []);
    const visRelationships = schemaVis.flatMap(
      (record) => record.relationships || []
    ); // Get unique node labels and relationship types from visualization
    const allNodeLabels = Array.from(
      new Set(visNodes.map((n) => n.labels?.[0]).filter(Boolean))
    );

    // Filter out labels starting with "p" and schema-related labels
    const nodeLabels = allNodeLabels.filter((label) => {
      // Exclude labels starting with "p" (e.g., p133222496104896977)
      if (label.startsWith("p")) {
        console.log(`Excluding label starting with 'p': ${label}`);
        return false;
      }
      // Exclude existing schema labels
      if (label === "migRaven_Schema" || label === "_migRaven_Schema") {
        console.log(`Excluding schema label: ${label}`);
        return false;
      }
      return true;
    });

    const relTypes = Array.from(
      new Set(visRelationships.map((r) => r.type).filter(Boolean))
    );

    console.log(
      `Filtered ${allNodeLabels.length} labels down to ${
        nodeLabels.length
      } labels (excluded ${allNodeLabels.length - nodeLabels.length} labels)`
    );
    console.log(
      `Excluded labels:`,
      allNodeLabels.filter((l) => !nodeLabels.includes(l))
    );

    console.log(
      `Found ${nodeLabels.length} node labels and ${relTypes.length} relationship types from schema visualization`
    ); // 2. Get indexes and constraints
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 2/6: Collecting indexes and constraints...</div>`;
    let indexes = [];
    let constraints = [];
    try {
      indexes = await executeNeo4jQuery("CALL db.indexes()");
    } catch (e) {
      console.warn("Could not load indexes:", e.message);
    }
    try {
      constraints = await executeNeo4jQuery("CALL db.constraints()");
    } catch (e) {
      console.warn("Could not load constraints:", e.message);
    } // 3. Clear existing _migRaven_Schema nodes and relationships
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 3/6: Clearing existing _migRaven_Schema nodes...</div>`;
    await executeNeo4jQuery("MATCH (n:_migRaven_Schema) DETACH DELETE n");

    const timestamp = new Date().toISOString();
    const schemaVersion = 1;
    const migRavenNodes = new Map(); // Store created _migRaven_Schema node IDs

    // 4. Create _migRaven_Schema nodes for each label with ALL properties
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 4/6: Creating _migRaven_Schema nodes for ${nodeLabels.length} labels...</div>`;

    for (let i = 0; i < nodeLabels.length; i++) {
      const label = nodeLabels[i];
      console.log(`Processing label ${i + 1}/${nodeLabels.length}: ${label}`);

      // Get ALL properties for this label across all nodes
      const propsResult = await executeNeo4jQuery(
        `MATCH (n:\`${label}\`) 
                         UNWIND keys(n) AS key 
                         RETURN DISTINCT key ORDER BY key`
      );

      const properties = {};
      for (const prop of propsResult) {
        const propKey = prop.key;

        // Determine type by sampling actual values
        let type = "string";
        let indexed = false;
        let unique = false;

        try {
          // Get sample values to determine type
          const sampleResult = await executeNeo4jQuery(
            `MATCH (n:\`${label}\`) 
                                 WHERE n.\`${propKey}\` IS NOT NULL 
                                 RETURN n.\`${propKey}\` AS value 
                                 LIMIT 5`
          );

          if (sampleResult.length > 0) {
            const firstValue = sampleResult[0].value;

            // Determine type from actual value
            if (typeof firstValue === "number") {
              type = Number.isInteger(firstValue) ? "integer" : "float";
            } else if (typeof firstValue === "boolean") {
              type = "boolean";
            } else if (Array.isArray(firstValue)) {
              type = "array";
            } else if (firstValue instanceof Date) {
              type = "datetime";
            } else {
              type = "string";
            }
          }

          // Check if property is indexed (look for indexes on this label/property)
          indexed = indexes.some(
            (idx) =>
              idx.labelsOrTypes?.includes(label) &&
              idx.properties?.includes(propKey)
          );

          // Check if property has unique constraint
          unique = constraints.some(
            (constraint) =>
              constraint.labelsOrTypes?.includes(label) &&
              constraint.properties?.includes(propKey) &&
              constraint.type?.toLowerCase().includes("unique")
          );
        } catch (e) {
          console.warn(
            `Error analyzing property ${propKey} for label ${label}:`,
            e.message
          );
        }

        properties[propKey] = {
          type: type,
          indexed: indexed,
          unique: unique,
          description: `Property ${propKey} of type ${type}${
            indexed ? " (indexed)" : ""
          }${unique ? " (unique)" : ""}`,
        };
      } // Create _migRaven_Schema node for this label
      const createNodeQuery = `
                        CREATE (n:_migRaven_Schema {
                            originalLabel: $originalLabel,
                            nodeType: 'node',
                            description: $description,
                            properties: $properties,
                            createdAt: $timestamp,
                            schemaVersion: $schemaVersion,
                            timestamp: $timestamp
                        })
                        RETURN id(n) AS nodeId
                    `;

      const nodeResult = await executeNeo4jQuery(createNodeQuery, {
        originalLabel: label,
        description: `Node type for label ${label} - Generated from database schema`,
        properties: JSON.stringify(properties),
        timestamp: timestamp,
        schemaVersion: schemaVersion,
      });

      if (nodeResult.length > 0) {
        migRavenNodes.set(label, nodeResult[0].nodeId);
      }
    }

    // 5. Create _SCHEMA_RELATIONSHIP connections between _migRaven_Schema nodes
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 5/6: Creating schema relationships for ${relTypes.length} relationship types...</div>`;

    for (let i = 0; i < relTypes.length; i++) {
      const relType = relTypes[i];
      console.log(
        `Processing relationship ${i + 1}/${relTypes.length}: ${relType}`
      );

      // Get distinct source/target pairs for this relationship type
      const relPairs = await executeNeo4jQuery(
        `MATCH (a)-[r:\`${relType}\`]->(b) 
                         RETURN DISTINCT labels(a)[0] AS sourceLabel, labels(b)[0] AS targetLabel`
      );

      for (const pair of relPairs) {
        // Get ALL properties for this relationship type
        const relPropsResult = await executeNeo4jQuery(
          `MATCH ()-[r:\`${relType}\`]->() 
                             UNWIND keys(r) AS key 
                             RETURN DISTINCT key ORDER BY key`
        );

        const relProperties = {};
        for (const prop of relPropsResult) {
          const propKey = prop.key;
          let type = "string";

          try {
            // Sample values to determine type
            const sampleResult = await executeNeo4jQuery(
              `MATCH ()-[r:\`${relType}\`]->() 
                                     WHERE r.\`${propKey}\` IS NOT NULL 
                                     RETURN r.\`${propKey}\` AS value 
                                     LIMIT 5`
            );

            if (sampleResult.length > 0) {
              const firstValue = sampleResult[0].value;
              if (typeof firstValue === "number") {
                type = Number.isInteger(firstValue) ? "integer" : "float";
              } else if (typeof firstValue === "boolean") {
                type = "boolean";
              } else if (Array.isArray(firstValue)) {
                type = "array";
              } else if (firstValue instanceof Date) {
                type = "datetime";
              }
            }
          } catch (e) {
            console.warn(
              `Error analyzing relationship property ${propKey}:`,
              e.message
            );
          }

          relProperties[propKey] = {
            type: type,
            description: `Relationship property ${propKey} of type ${type}`,
          };
        }

        // Create _SCHEMA_RELATIONSHIP between source and target _migRaven_Schema nodes
        if (
          migRavenNodes.has(pair.sourceLabel) &&
          migRavenNodes.has(pair.targetLabel)
        ) {
          const createRelQuery = `
                                MATCH (source:_migRaven_Schema), (target:_migRaven_Schema)
                                WHERE id(source) = $sourceId AND id(target) = $targetId
                                CREATE (source)-[r:_SCHEMA_RELATIONSHIP {
                                    originalType: $originalType,
                                    properties: $properties,
                                    description: $description,
                                    createdAt: $timestamp,
                                    schemaVersion: $schemaVersion,
                                    timestamp: $timestamp
                                }]->(target)
                                RETURN r
                            `;

          await executeNeo4jQuery(createRelQuery, {
            sourceId: migRavenNodes.get(pair.sourceLabel),
            targetId: migRavenNodes.get(pair.targetLabel),
            originalType: relType,
            properties: JSON.stringify(relProperties),
            description: `Relationship ${relType} from ${pair.sourceLabel} to ${pair.targetLabel} - Generated from database schema`,
            timestamp: timestamp,
            schemaVersion: schemaVersion,
          });
        }
      }
    }

    // 6. Create schema metadata node
    statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 6/6: Creating schema metadata...</div>`;

    const metaQuery = `
                    CREATE (meta:_migRaven_Schema {
                        nodeType: 'metadata',
                        schemaVersion: $schemaVersion,
                        timestamp: $timestamp,
                        description: $description,
                        totalNodes: $totalNodes,
                        totalRelationships: $totalRelationships,
                        indexes: $indexes,
                        constraints: $constraints,
                        createdAt: $timestamp,
                        generatedFromVisualization: true
                    })
                    RETURN meta
                `;

    await executeNeo4jQuery(metaQuery, {
      schemaVersion: schemaVersion,
      timestamp: timestamp,
      description: `Complete schema generated from Neo4j database using db.schema.visualization() on ${new Date().toLocaleDateString()}`,
      totalNodes: nodeLabels.length,
      totalRelationships: relTypes.length,
      indexes: JSON.stringify(indexes),
      constraints: JSON.stringify(constraints),
    });

    // 7. Create local schema object for UI
    const newSchema = {
      version: schemaVersion,
      timestamp: timestamp,
      description:
        "Complete schema generated from database using db.schema.visualization() and saved as _migRaven_Schema nodes",
      node_types: [],
      indexes: indexes,
      constraints: constraints,
    };

    // Rebuild local schema for UI from what we just saved
    for (const label of nodeLabels) {
      // Get properties again for UI consistency
      const propsResult = await executeNeo4jQuery(
        `MATCH (n:\`${label}\`) 
                         UNWIND keys(n) AS key 
                         RETURN DISTINCT key ORDER BY key`
      );

      const nodeType = {
        label: label,
        description: `Node type for label ${label} - Generated from database schema`,
        attributes: {},
        relationships: {},
      };

      for (const prop of propsResult) {
        const propKey = prop.key;
        let type = "string";
        let indexed = false;
        let unique = false;

        try {
          const sampleResult = await executeNeo4jQuery(
            `MATCH (n:\`${label}\`) 
                                 WHERE n.\`${propKey}\` IS NOT NULL 
                                 RETURN n.\`${propKey}\` AS value 
                                 LIMIT 1`
          );

          if (sampleResult.length > 0) {
            const firstValue = sampleResult[0].value;
            if (typeof firstValue === "number") {
              type = Number.isInteger(firstValue) ? "integer" : "float";
            } else if (typeof firstValue === "boolean") {
              type = "boolean";
            } else if (Array.isArray(firstValue)) {
              type = "array";
            } else if (firstValue instanceof Date) {
              type = "datetime";
            } else {
              type = "string";
            }
          }

          indexed = indexes.some(
            (idx) =>
              idx.labelsOrTypes?.includes(label) &&
              idx.properties?.includes(propKey)
          );

          unique = constraints.some(
            (constraint) =>
              constraint.labelsOrTypes?.includes(label) &&
              constraint.properties?.includes(propKey) &&
              constraint.type?.toLowerCase().includes("unique")
          );
        } catch (e) {}

        nodeType.attributes[propKey] = {
          type: type,
          indexed: indexed,
          unique: unique,
          description: `Property ${propKey} of type ${type}${
            indexed ? " (indexed)" : ""
          }${unique ? " (unique)" : ""}`,
        };
      }

      newSchema.node_types.push(nodeType);
    }

    // Add relationships to node types for UI
    for (const relType of relTypes) {
      const relPairs = await executeNeo4jQuery(
        `MATCH (a)-[r:\`${relType}\`]->(b) 
                         RETURN DISTINCT labels(a)[0] AS sourceLabel, labels(b)[0] AS targetLabel`
      );

      for (const pair of relPairs) {
        const sourceNode = newSchema.node_types.find(
          (n) => n.label === pair.sourceLabel
        );
        if (sourceNode) {
          // Get relationship properties for UI
          const relPropsResult = await executeNeo4jQuery(
            `MATCH ()-[r:\`${relType}\`]->() 
                                 UNWIND keys(r) AS key 
                                 RETURN DISTINCT key ORDER BY key`
          );

          const relProps = {};
          for (const prop of relPropsResult) {
            let type = "string";
            try {
              const sampleResult = await executeNeo4jQuery(
                `MATCH ()-[r:\`${relType}\`]->() 
                                         WHERE r.\`${prop.key}\` IS NOT NULL 
                                         RETURN r.\`${prop.key}\` AS value 
                                         LIMIT 1`
              );

              if (sampleResult.length > 0) {
                const firstValue = sampleResult[0].value;
                if (typeof firstValue === "number") {
                  type = Number.isInteger(firstValue) ? "integer" : "float";
                } else if (typeof firstValue === "boolean") {
                  type = "boolean";
                } else if (Array.isArray(firstValue)) {
                  type = "array";
                } else if (firstValue instanceof Date) {
                  type = "datetime";
                }
              }
            } catch (e) {}

            relProps[prop.key] = {
              type: type,
              description: `Relationship property ${prop.key} of type ${type}`,
            };
          }

          sourceNode.relationships[relType] = {
            target: pair.targetLabel,
            description: `Relationship ${relType} from ${pair.sourceLabel} to ${pair.targetLabel} - Generated from database schema`,
            properties: relProps,
          };
        }
      }
    }

    // 8. Update UI and state
    schemaData = newSchema;
    localSchemaFilePath = `generated_complete_schema_v${schemaData.version}.json`;
    isModified = false; // Already saved to DB
    dbSchemaInfo = {
      version: schemaVersion,
      timestamp: timestamp,
      metaId: "_migRaven_Schema_Complete_Generated",
    };

    renderTreeView();
    updateStats();
    updateSchemaInfoDisplay(
      "Generated from DB (Complete Schema)",
      schemaData.version,
      schemaData.timestamp
    );

    // Select first node if available
    if (schemaData.node_types.length > 0) {
      selectNode(0);
    } else {
      document.getElementById("detailsContainer").innerHTML =
        '<div class="no-selection"><p>Schema generated but no node types found.</p></div>';
    }

    updateModifiedStatus(false); // Already saved to DB
    document.getElementById("downloadBtn").disabled = false;
    document.getElementById("cypherBtn").disabled = false;
    document.getElementById("saveToDbBtn").disabled = true; // Already saved
    document.getElementById("compareBtn").disabled = false;
    document.getElementById("statsBar").style.display = "flex";

    statusDiv.innerHTML = `<div class="connection-success">✅ Complete schema successfully generated and saved as _migRaven_Schema nodes (${
      nodeLabels.length
    } node types, ${relTypes.length} relationship types, ${Object.values(
      newSchema.node_types
    ).reduce(
      (sum, nt) => sum + Object.keys(nt.attributes).length,
      0
    )} total properties).</div>`;
    alert(`Schema generation complete! 
                       
Generated from db.schema.visualization():
• ${nodeLabels.length} node types
• ${relTypes.length} relationship types  
• ${Object.values(newSchema.node_types).reduce(
      (sum, nt) => sum + Object.keys(nt.attributes).length,
      0
    )} total properties across all nodes
• ${indexes.length} indexes
• ${constraints.length} constraints

All data saved as _migRaven_Schema nodes in the database.`);
  } catch (error) {
    console.error("Error generating complete schema from DB:", error);
    statusDiv.innerHTML = `<div class="connection-error">❌ Error generating schema: ${error.message}. Check console for details.</div>`;
    alert(`Error generating complete schema: ${error.message}`);
  }
}

// ===== DIFFERENTIAL SCHEMA UPDATES =====

async function updateSchemaWithDiff(schemaData, timestamp, version, statusDiv) {
  // Get existing nodes from database for comparison
  const existingNodes = await executeNeo4jQuery(
    `MATCH (n:_migRaven_Schema {nodeType: 'node'}) 
     RETURN id(n) AS nodeId, n.originalLabel AS label, n.properties AS properties, n.description AS description`
  );

  // Create a map of existing nodes for quick lookup
  const existingNodesMap = new Map();
  existingNodes.forEach((node) => {
    existingNodesMap.set(node.label, {
      nodeId: node.nodeId,
      properties: JSON.parse(node.properties || "{}"),
      description: node.description,
    });
  });

  statusDiv.innerHTML = `<div class="connection-warning">🔄 Step 4/5: Updating changed schema elements...</div>`;

  const migRavenNodes = new Map(); // Store node IDs for relationship creation
  let updatedNodes = 0;
  let newNodes = 0;
  let updatedRelationships = 0;
  let deletedNodes = 0;

  // Process node types - update existing or create new
  for (const nodeType of schemaData.node_types) {
    // Skip relationship pseudo-nodes
    if (nodeType.originalType) continue;

    const properties = {};
    for (const [attrName, attrInfo] of Object.entries(
      nodeType.attributes || {}
    )) {
      properties[attrName] = {
        type: attrInfo.type || "string",
        indexed: attrInfo.indexed || false,
        unique: attrInfo.unique || false,
        description: attrInfo.description || `Property ${attrName}`,
      };
    }

    const propertiesJson = JSON.stringify(properties);

    if (existingNodesMap.has(nodeType.label)) {
      // Node exists - check if it needs updating
      const existingNode = existingNodesMap.get(nodeType.label);
      const existingPropertiesJson = JSON.stringify(existingNode.properties);

      if (
        propertiesJson !== existingPropertiesJson ||
        nodeType.description !== existingNode.description
      ) {
        // Node properties or description changed - update it
        const updateNodeQuery = `
          MATCH (n:_migRaven_Schema) 
          WHERE id(n) = $nodeId
          SET n.properties = $properties,
              n.description = $description,
              n.timestamp = $timestamp,
              n.schemaVersion = $schemaVersion,
              n.updatedAt = $timestamp
          RETURN id(n) AS nodeId
        `;

        const result = await executeNeo4jQuery(updateNodeQuery, {
          nodeId: existingNode.nodeId,
          properties: propertiesJson,
          description: nodeType.description || `Node type ${nodeType.label}`,
          timestamp: timestamp,
          schemaVersion: version,
        });

        if (result.length > 0) {
          migRavenNodes.set(nodeType.label, result[0].nodeId);
          updatedNodes++;
        }
      } else {
        // Node unchanged - keep reference for relationships
        migRavenNodes.set(nodeType.label, existingNode.nodeId);
      }

      // Mark this node as processed
      existingNodesMap.delete(nodeType.label);
    } else {
      // Node does not exist - create new
      const createNodeQuery = `
        CREATE (n:_migRaven_Schema {
          originalLabel: $originalLabel,
          nodeType: 'node',
          description: $description,
          properties: $properties,
          createdAt: $timestamp,
          schemaVersion: $schemaVersion,
          timestamp: $timestamp
        })
        RETURN id(n) AS nodeId
      `;

      const result = await executeNeo4jQuery(createNodeQuery, {
        originalLabel: nodeType.label,
        description: nodeType.description || `Node type ${nodeType.label}`,
        properties: propertiesJson,
        timestamp: timestamp,
        schemaVersion: version,
      });

      if (result.length > 0) {
        migRavenNodes.set(nodeType.label, result[0].nodeId);
        newNodes++;
      }
    }
  }

  // Delete nodes that exist in DB but not in local schema
  if (existingNodesMap.size > 0) {
    const nodesToDelete = Array.from(existingNodesMap.keys());
    deletedNodes = nodesToDelete.length;

    for (const nodeLabel of nodesToDelete) {
      await executeNeo4jQuery(
        `MATCH (n:_migRaven_Schema {originalLabel: $label, nodeType: 'node'})
         DETACH DELETE n`,
        { label: nodeLabel }
      );
    }
  }

  // Get existing relationships from database for comparison
  const existingRelationships = await executeNeo4jQuery(
    `MATCH (source:_migRaven_Schema {nodeType: 'node'})-[r:_SCHEMA_RELATIONSHIP]->(target:_migRaven_Schema {nodeType: 'node'})
     RETURN id(r) AS relId, source.originalLabel AS sourceLabel, target.originalLabel AS targetLabel,
           r.originalType AS relType, r.properties AS properties, r.description AS description`
  );

  // Create a map of existing relationships for quick lookup
  const existingRelMap = new Map();
  existingRelationships.forEach((rel) => {
    const key = `${rel.sourceLabel}|${rel.relType}|${rel.targetLabel}`;
    existingRelMap.set(key, {
      relId: rel.relId,
      properties: JSON.parse(rel.properties || "{}"),
      description: rel.description,
    });
  });

  // Process relationships - update existing or create new
  for (const nodeType of schemaData.node_types) {
    // Skip relationship pseudo-nodes
    if (nodeType.originalType) continue;

    // Skip if source node not found
    if (!migRavenNodes.has(nodeType.label)) continue;

    for (const [relName, relInfo] of Object.entries(
      nodeType.relationships || {}
    )) {
      const targetLabel = relInfo.target;

      // Skip if target node not found
      if (!migRavenNodes.has(targetLabel)) continue;

      const relProperties = {};
      for (const [propName, propInfo] of Object.entries(
        relInfo.properties || {}
      )) {
        relProperties[propName] = {
          type: propInfo.type || "string",
          description:
            propInfo.description || `Relationship property ${propName}`,
        };
      }

      const relPropertiesJson = JSON.stringify(relProperties);
      const relKey = `${nodeType.label}|${relName}|${targetLabel}`;

      if (existingRelMap.has(relKey)) {
        // Relationship exists - check if it needs updating
        const existingRel = existingRelMap.get(relKey);
        const existingPropertiesJson = JSON.stringify(existingRel.properties);

        if (
          relPropertiesJson !== existingPropertiesJson ||
          relInfo.description !== existingRel.description
        ) {
          // Relationship changed - update it
          const updateRelQuery = `
            MATCH ()-[r]->() 
            WHERE id(r) = $relId
            SET r.properties = $properties,
                r.description = $description,
                r.timestamp = $timestamp,
                r.schemaVersion = $schemaVersion,
                r.updatedAt = $timestamp
          `;

          await executeNeo4jQuery(updateRelQuery, {
            relId: existingRel.relId,
            properties: relPropertiesJson,
            description: relInfo.description || `Relationship ${relName}`,
            timestamp: timestamp,
            schemaVersion: version,
          });

          updatedRelationships++;
        }

        // Mark this relationship as processed
        existingRelMap.delete(relKey);
      } else {
        // Relationship doesn't exist - create new
        const createRelQuery = `
          MATCH (source:_migRaven_Schema), (target:_migRaven_Schema)
          WHERE id(source) = $sourceId AND id(target) = $targetId
          CREATE (source)-[r:_SCHEMA_RELATIONSHIP {
            originalType: $originalType,
            properties: $properties,
            description: $description,
            createdAt: $timestamp,
            schemaVersion: $schemaVersion,
            timestamp: $timestamp
          }]->(target)
        `;

        await executeNeo4jQuery(createRelQuery, {
          sourceId: migRavenNodes.get(nodeType.label),
          targetId: migRavenNodes.get(targetLabel),
          originalType: relName,
          properties: relPropertiesJson,
          description: relInfo.description || `Relationship ${relName}`,
          timestamp: timestamp,
          schemaVersion: version,
        });
      }
    }
  }
  // Delete relationships that exist in DB but not in local schema
  let deletedRels = 0;
  if (existingRelMap.size > 0) {
    const relsToDelete = Array.from(existingRelMap.values()).map(
      (r) => r.relId
    );
    deletedRels = relsToDelete.length;

    for (const relId of relsToDelete) {
      await executeNeo4jQuery(
        `MATCH ()-[r]->() WHERE id(r) = $relId DELETE r`,
        { relId: relId }
      );
    }
  }

  // Update metadata node
  await executeNeo4jQuery(
    "MATCH (n:_migRaven_Schema {nodeType: 'metadata'}) DELETE n"
  );

  const updateStats = {
    newNodes,
    updatedNodes,
    deletedNodes,
    updatedRelationships,
    deletedRelationships: deletedRels,
    timestamp: timestamp,
  };

  // Return update stats for display
  return {
    migRavenNodes,
    updateStats,
    nodeChanges: newNodes + updatedNodes + deletedNodes,
    relationshipChanges: updatedRelationships + deletedRels,
  };
}

// ===== HELPER FUNCTIONS FOR DIFFERENTIAL UPDATES =====

function deepCompareProperties(props1, props2) {
  // Helper function to compare two property objects deeply
  const keys1 = Object.keys(props1).sort();
  const keys2 = Object.keys(props2).sort();

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) {
      return false;
    }

    const prop1 = props1[keys1[i]];
    const prop2 = props2[keys1[i]];

    if (typeof prop1 !== typeof prop2) {
      return false;
    }

    if (typeof prop1 === "object") {
      if (!deepCompareProperties(prop1, prop2)) {
        return false;
      }
    } else if (prop1 !== prop2) {
      return false;
    }
  }

  return true;
}

function hasSignificantChanges(node1, node2) {
  // Check if there are significant changes that warrant an update
  if (node1.description !== node2.description) {
    return true;
  }

  return !deepCompareProperties(node1.properties || {}, node2.properties || {});
}

// Make main functions available globally for HTML onclick handlers
window.testConnection = testConnection;
window.toggleNeo4jConfig = toggleNeo4jConfig;
window.loadSchemaFromNeo4j = loadSchemaFromNeo4j;
window.saveSchemaToNeo4j = saveSchemaToNeo4j;
window.generateSchemaFromDb = generateSchemaFromDb;
window.exportToCypher = exportToCypher;
window.closeCypherModal = closeCypherModal;
window.confirmCypherExport = confirmCypherExport;
window.downloadSchema = downloadSchema;
window.compareWithDbSchema = compareWithDbSchema;
