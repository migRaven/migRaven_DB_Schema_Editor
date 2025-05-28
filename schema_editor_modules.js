// ===== MODULE: Configuration and State Management =====

const SchemaEditorConfig = {
  neo4j: {
    url: "",
    username: "",
    password: "",
    database: "",
    connected: false,
  },
  constants: {
    GLOBAL_SCHEMA_META_ID: "_migRaven_Schema",
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
  },
};

const SchemaEditorState = {
  schemaData: null,
  currentNode: null,
  isModified: false,
  neo4jDriver: null,
  lastCypherQueryForExport: "",
  dbSchemaInfo: null,
  localSchemaFilePath: null,
  // Property change tracking
  propertyChanges: {
    nodes: new Map(), // Map<nodeLabel, Map<propertyPath, {old, new, timestamp}>>
    relationships: new Map(), // Map<relKey, Map<propertyPath, {old, new, timestamp}>>
    getChangeCount() {
      let count = 0;
      this.nodes.forEach((node) => (count += node.size));
      this.relationships.forEach((rel) => (count += rel.size));
      return count;
    },
    clear() {
      this.nodes.clear();
      this.relationships.clear();
    },
  },
};

// ===== MODULE: Progress Manager =====
const ProgressManager = {
  activeOperations: new Map(),

  start(operationId, totalSteps, description) {
    this.activeOperations.set(operationId, {
      current: 0,
      total: totalSteps,
      description,
      startTime: Date.now(),
    });
    this.updateUI(operationId);
  },

  update(operationId, currentStep, message) {
    const op = this.activeOperations.get(operationId);
    if (op) {
      op.current = currentStep;
      op.message = message;
      this.updateUI(operationId);
    }
  },

  complete(operationId) {
    this.activeOperations.delete(operationId);
    this.hideProgressUI();
  },

  updateUI(operationId) {
    const op = this.activeOperations.get(operationId);
    if (!op) return;

    let progressDiv = document.getElementById("globalProgress");
    if (!progressDiv) {
      progressDiv = document.createElement("div");
      progressDiv.id = "globalProgress";
      progressDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #007bff;
        color: white;
        padding: 10px;
        z-index: 9999;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      document.body.prepend(progressDiv);
    }

    const percentage = Math.round((op.current / op.total) * 100);
    progressDiv.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span>${op.description}: ${
      op.message || `Step ${op.current} of ${op.total}`
    }</span>
        <span>${percentage}%</span>
      </div>
      <div style="background: rgba(255,255,255,0.3); height: 4px; margin-top: 5px; border-radius: 2px;">
        <div style="background: white; height: 100%; width: ${percentage}%; border-radius: 2px; transition: width 0.3s;"></div>
      </div>
    `;
  },

  hideProgressUI() {
    const progressDiv = document.getElementById("globalProgress");
    if (progressDiv) {
      progressDiv.remove();
    }
  },
};

// ===== MODULE: Error Handler =====
const ErrorHandler = {
  handleError(error, context, userMessage) {
    console.error(`Error in ${context}:`, error);

    // Log to console with full stack trace
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    // Show user-friendly message
    const message = userMessage || `An error occurred: ${error.message}`;
    this.showErrorToUser(message, context);

    // Return standardized error response
    return {
      success: false,
      error: error.message,
      context,
      timestamp: new Date().toISOString(),
    };
  },

  showErrorToUser(message, context) {
    // Create or update error notification
    let errorDiv = document.getElementById("errorNotification");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "errorNotification";
      errorDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 15px 20px;
        border-radius: 4px;
        max-width: 400px;
        z-index: 9998;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      document.body.appendChild(errorDiv);
    }

    errorDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <strong>Error in ${context}</strong><br>
          <span style="font-size: 14px;">${message}</span>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          margin-left: 10px;
        ">&times;</button>
      </div>
    `;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentElement) {
        errorDiv.remove();
      }
    }, 5000);
  },

  async retryOperation(
    operation,
    context,
    maxRetries = SchemaEditorConfig.constants.MAX_RETRIES
  ) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(
          `Retry ${i + 1}/${maxRetries} for ${context}:`,
          error.message
        );
        if (i < maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              SchemaEditorConfig.constants.RETRY_DELAY * (i + 1)
            )
          );
        }
      }
    }
    throw lastError;
  },
};

// ===== MODULE: Change Tracker =====
const ChangeTracker = {
  trackNodeChange(nodeLabel, propertyPath, oldValue, newValue) {
    if (!SchemaEditorState.propertyChanges.nodes.has(nodeLabel)) {
      SchemaEditorState.propertyChanges.nodes.set(nodeLabel, new Map());
    }

    const nodeChanges = SchemaEditorState.propertyChanges.nodes.get(nodeLabel);
    nodeChanges.set(propertyPath, {
      old: oldValue,
      new: newValue,
      timestamp: new Date().toISOString(),
    });

    this.updateChangeIndicator();
  },

  trackRelationshipChange(
    sourceLabel,
    relName,
    targetLabel,
    propertyPath,
    oldValue,
    newValue
  ) {
    const relKey = `${sourceLabel}|${relName}|${targetLabel}`;
    if (!SchemaEditorState.propertyChanges.relationships.has(relKey)) {
      SchemaEditorState.propertyChanges.relationships.set(relKey, new Map());
    }

    const relChanges =
      SchemaEditorState.propertyChanges.relationships.get(relKey);
    relChanges.set(propertyPath, {
      old: oldValue,
      new: newValue,
      timestamp: new Date().toISOString(),
    });

    this.updateChangeIndicator();
  },

  updateChangeIndicator() {
    const count = SchemaEditorState.propertyChanges.getChangeCount();
    let indicator = document.getElementById("changeIndicator");

    if (count > 0) {
      if (!indicator) {
        const statsBar = document.getElementById("statsBar");
        indicator = document.createElement("button");
        indicator.id = "changeIndicator";
        indicator.className = "btn btn-warning btn-small";
        indicator.onclick = () => this.showChangesModal();
        indicator.style.marginLeft = "10px";
        statsBar.appendChild(indicator);
      }
      indicator.innerHTML = `📝 Modified Properties (${count})`;
      indicator.style.display = "inline-block";
    } else if (indicator) {
      indicator.style.display = "none";
    }
  },

  showChangesModal() {
    const changes = this.getFormattedChanges();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "block";
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px;">
        <div class="modal-header">
          <span class="close-btn" onclick="this.closest('.modal').remove()">&times;</span>
          <h2>Modified Properties</h2>
        </div>
        <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
          ${
            changes.length === 0
              ? "<p>No changes tracked.</p>"
              : this.renderChangesTable(changes)
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
          <button class="btn btn-primary" onclick="ChangeTracker.clearChanges(); this.closest('.modal').remove()">Clear Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  getFormattedChanges() {
    const changes = [];

    // Node changes
    SchemaEditorState.propertyChanges.nodes.forEach(
      (nodeChanges, nodeLabel) => {
        nodeChanges.forEach((change, propertyPath) => {
          changes.push({
            type: "node",
            label: nodeLabel,
            property: propertyPath,
            oldValue: change.old,
            newValue: change.new,
            timestamp: change.timestamp,
          });
        });
      }
    );

    // Relationship changes
    SchemaEditorState.propertyChanges.relationships.forEach(
      (relChanges, relKey) => {
        const [source, relType, target] = relKey.split("|");
        relChanges.forEach((change, propertyPath) => {
          changes.push({
            type: "relationship",
            label: `${source} -[${relType}]-> ${target}`,
            property: propertyPath,
            oldValue: change.old,
            newValue: change.new,
            timestamp: change.timestamp,
          });
        });
      }
    );

    return changes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },

  renderChangesTable(changes) {
    const rows = changes
      .map(
        (change) => `
      <tr>
        <td><span class="badge ${
          change.type === "node" ? "badge-primary" : "badge-info"
        }">${change.type}</span></td>
        <td>${change.label}</td>
        <td>${change.property}</td>
        <td><code>${change.oldValue || "(empty)"}</code></td>
        <td><code>${change.newValue || "(empty)"}</code></td>
        <td>${new Date(change.timestamp).toLocaleString()}</td>
      </tr>
    `
      )
      .join("");

    return `
      <table class="changes-table" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th>Type</th>
            <th>Element</th>
            <th>Property</th>
            <th>Old Value</th>
            <th>New Value</th>
            <th>Changed At</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  },

  clearChanges() {
    SchemaEditorState.propertyChanges.clear();
    this.updateChangeIndicator();
  },

  getChangesForComparison() {
    return {
      nodes: Array.from(SchemaEditorState.propertyChanges.nodes.entries()).map(
        ([label, changes]) => ({
          label,
          changes: Array.from(changes.entries()).map(([prop, change]) => ({
            property: prop,
            ...change,
          })),
        })
      ),
      relationships: Array.from(
        SchemaEditorState.propertyChanges.relationships.entries()
      ).map(([key, changes]) => {
        const [source, relType, target] = key.split("|");
        return {
          source,
          relType,
          target,
          changes: Array.from(changes.entries()).map(([prop, change]) => ({
            property: prop,
            ...change,
          })),
        };
      }),
    };
  },
};

// ===== MODULE: Neo4j Connection Manager =====
const Neo4jConnection = {
  async connect(url, username, password, database) {
    try {
      if (SchemaEditorState.neo4jDriver) {
        await this.disconnect();
      }

      SchemaEditorState.neo4jDriver = neo4j.driver(
        url,
        neo4j.auth.basic(username, password)
      );

      const verificationConfig = database ? { database } : {};
      await SchemaEditorState.neo4jDriver.verifyConnectivity(
        verificationConfig
      );

      // Update config
      Object.assign(SchemaEditorConfig.neo4j, {
        url,
        username,
        password,
        database,
        connected: true,
      });

      return { success: true };
    } catch (error) {
      SchemaEditorConfig.neo4j.connected = false;
      throw error;
    }
  },

  async disconnect() {
    if (SchemaEditorState.neo4jDriver) {
      try {
        await SchemaEditorState.neo4jDriver.close();
      } catch (e) {
        console.warn("Error closing Neo4j driver:", e);
      }
      SchemaEditorState.neo4jDriver = null;
      SchemaEditorConfig.neo4j.connected = false;
    }
  },

  async executeQuery(query, params = {}) {
    if (!SchemaEditorConfig.neo4j.connected || !SchemaEditorState.neo4jDriver) {
      throw new Error("Not connected to Neo4j. Please test connection first.");
    }

    const sessionConfig = SchemaEditorConfig.neo4j.database
      ? { database: SchemaEditorConfig.neo4j.database }
      : {};

    const session = SchemaEditorState.neo4jDriver.session(sessionConfig);

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
    } finally {
      await session.close();
    }
  },
};

// ===== MODULE: Schema Operations =====
const SchemaOperations = {
  async loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          let loadedData = JSON.parse(e.target.result);

          // Validate and fix schema
          if (typeof loadedData.version !== "number") {
            loadedData.version = 1;
            SchemaEditorState.isModified = true;
          }
          if (typeof loadedData.timestamp !== "string") {
            loadedData.timestamp = new Date().toISOString();
            SchemaEditorState.isModified = true;
          }

          SchemaEditorState.schemaData = loadedData;
          SchemaEditorState.dbSchemaInfo = null;
          SchemaEditorState.localSchemaFilePath = file.name;

          resolve(loadedData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  },

  saveToFile() {
    const schema = SchemaEditorState.schemaData;
    if (!schema) throw new Error("No schema to save");

    // Increment version
    schema.version = (schema.version || 0) + 1;
    schema.timestamp = new Date().toISOString();

    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(schema, null, 2));

    const fileName = SchemaEditorState.localSchemaFilePath
      ? SchemaEditorState.localSchemaFilePath.replace(/\.json$/i, "") +
        `_v${schema.version}.json`
      : `schema_v${schema.version}.json`;

    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();

    return { version: schema.version, timestamp: schema.timestamp };
  },

  async generateFromDatabase() {
    const operationId = "generateSchema";
    ProgressManager.start(operationId, 6, "Generating schema from database");

    try {
      // Step 1: Get schema visualization
      ProgressManager.update(operationId, 1, "Reading schema visualization");
      const schemaVis = await Neo4jConnection.executeQuery(
        "CALL db.schema.visualization()"
      );

      // Extract and filter labels
      const visNodes = schemaVis.flatMap((record) => record.nodes || []);
      const allNodeLabels = Array.from(
        new Set(visNodes.map((n) => n.labels?.[0]).filter(Boolean))
      );
      const nodeLabels = allNodeLabels.filter(
        (label) =>
          !label.startsWith("p") &&
          label !== "migRaven_Schema" &&
          label !== "_migRaven_Schema"
      );

      // Extract relationship types
      const visRelationships = schemaVis.flatMap(
        (record) => record.relationships || []
      );
      const relTypes = Array.from(
        new Set(visRelationships.map((r) => r.type).filter(Boolean))
      );

      // Step 2: Get indexes and constraints
      ProgressManager.update(
        operationId,
        2,
        "Collecting indexes and constraints"
      );
      let indexes = [],
        constraints = [];
      try {
        indexes = await Neo4jConnection.executeQuery("CALL db.indexes()");
        constraints = await Neo4jConnection.executeQuery(
          "CALL db.constraints()"
        );
      } catch (e) {
        console.warn("Could not load indexes/constraints:", e);
      }

      // Step 3: Clear existing schema nodes
      ProgressManager.update(operationId, 3, "Clearing existing schema nodes");
      await Neo4jConnection.executeQuery(
        "MATCH (n:_migRaven_Schema) DETACH DELETE n"
      );

      // Step 4: Create schema nodes
      ProgressManager.update(
        operationId,
        4,
        `Creating schema nodes for ${nodeLabels.length} labels`
      );
      const timestamp = new Date().toISOString();
      const schemaVersion = 1;
      const migRavenNodes = new Map();

      // Process each label
      for (let i = 0; i < nodeLabels.length; i++) {
        const label = nodeLabels[i];
        const properties = await this._extractNodeProperties(
          label,
          indexes,
          constraints
        );

        const result = await Neo4jConnection.executeQuery(
          `CREATE (n:_migRaven_Schema {
            originalLabel: $originalLabel,
            nodeType: 'node',
            description: $description,
            properties: $properties,
            createdAt: $timestamp,
            schemaVersion: $schemaVersion,
            timestamp: $timestamp
          }) RETURN id(n) AS nodeId`,
          {
            originalLabel: label,
            description: `Node type for label ${label} - Generated from database schema`,
            properties: JSON.stringify(properties),
            timestamp,
            schemaVersion,
          }
        );

        if (result.length > 0) {
          migRavenNodes.set(label, result[0].nodeId);
        }
      }

      // Step 5: Create relationships
      ProgressManager.update(
        operationId,
        5,
        `Creating ${relTypes.length} relationship types`
      );
      await this._createSchemaRelationships(
        relTypes,
        migRavenNodes,
        timestamp,
        schemaVersion
      );

      // Step 6: Create metadata
      ProgressManager.update(operationId, 6, "Creating schema metadata");
      await this._createSchemaMetadata(
        nodeLabels,
        relTypes,
        indexes,
        constraints,
        timestamp,
        schemaVersion
      );

      // Build local schema object
      const newSchema = await this._buildLocalSchema(
        nodeLabels,
        relTypes,
        indexes,
        constraints,
        timestamp,
        schemaVersion
      );

      SchemaEditorState.schemaData = newSchema;
      SchemaEditorState.isModified = false;
      SchemaEditorState.dbSchemaInfo = {
        version: schemaVersion,
        timestamp,
        metaId: "_migRaven_Schema_Generated",
      };

      ProgressManager.complete(operationId);
      return newSchema;
    } catch (error) {
      ProgressManager.complete(operationId);
      throw error;
    }
  },

  async _extractNodeProperties(label, indexes, constraints) {
    const propsResult = await Neo4jConnection.executeQuery(
      `MATCH (n:\`${label}\`) UNWIND keys(n) AS key RETURN DISTINCT key ORDER BY key`
    );

    const properties = {};
    for (const prop of propsResult) {
      const propKey = prop.key;
      let type = "string";
      let indexed = false;
      let unique = false;

      try {
        // Sample values to determine type
        const sampleResult = await Neo4jConnection.executeQuery(
          `MATCH (n:\`${label}\`) WHERE n.\`${propKey}\` IS NOT NULL 
           RETURN n.\`${propKey}\` AS value LIMIT 5`
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

        // Check indexing
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
      } catch (e) {
        console.warn(`Error analyzing property ${propKey}:`, e);
      }

      properties[propKey] = {
        type,
        indexed,
        unique,
        description: `Property ${propKey} of type ${type}${
          indexed ? " (indexed)" : ""
        }${unique ? " (unique)" : ""}`,
      };
    }

    return properties;
  },

  async _createSchemaRelationships(
    relTypes,
    migRavenNodes,
    timestamp,
    schemaVersion
  ) {
    for (const relType of relTypes) {
      const relPairs = await Neo4jConnection.executeQuery(
        `MATCH (a)-[r:\`${relType}\`]->(b) 
         RETURN DISTINCT labels(a)[0] AS sourceLabel, labels(b)[0] AS targetLabel`
      );

      for (const pair of relPairs) {
        if (
          !migRavenNodes.has(pair.sourceLabel) ||
          !migRavenNodes.has(pair.targetLabel)
        ) {
          continue;
        }

        const relProperties = await this._extractRelationshipProperties(
          relType
        );

        await Neo4jConnection.executeQuery(
          `MATCH (source:_migRaven_Schema), (target:_migRaven_Schema)
           WHERE id(source) = $sourceId AND id(target) = $targetId
           CREATE (source)-[r:_SCHEMA_RELATIONSHIP {
             originalType: $originalType,
             properties: $properties,
             description: $description,
             createdAt: $timestamp,
             schemaVersion: $schemaVersion,
             timestamp: $timestamp
           }]->(target)`,
          {
            sourceId: migRavenNodes.get(pair.sourceLabel),
            targetId: migRavenNodes.get(pair.targetLabel),
            originalType: relType,
            properties: JSON.stringify(relProperties),
            description: `Relationship ${relType} from ${pair.sourceLabel} to ${pair.targetLabel}`,
            timestamp,
            schemaVersion,
          }
        );
      }
    }
  },

  async _extractRelationshipProperties(relType) {
    const propsResult = await Neo4jConnection.executeQuery(
      `MATCH ()-[r:\`${relType}\`]->() UNWIND keys(r) AS key RETURN DISTINCT key ORDER BY key`
    );

    const properties = {};
    for (const prop of propsResult) {
      let type = "string";

      try {
        const sampleResult = await Neo4jConnection.executeQuery(
          `MATCH ()-[r:\`${relType}\`]->() WHERE r.\`${prop.key}\` IS NOT NULL 
           RETURN r.\`${prop.key}\` AS value LIMIT 5`
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
        console.warn(`Error analyzing relationship property ${prop.key}:`, e);
      }

      properties[prop.key] = {
        type,
        description: `Relationship property ${prop.key} of type ${type}`,
      };
    }

    return properties;
  },

  async _createSchemaMetadata(
    nodeLabels,
    relTypes,
    indexes,
    constraints,
    timestamp,
    schemaVersion
  ) {
    await Neo4jConnection.executeQuery(
      `CREATE (meta:_migRaven_Schema {
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
      })`,
      {
        schemaVersion,
        timestamp,
        description: `Complete schema generated from Neo4j database on ${new Date().toLocaleDateString()}`,
        totalNodes: nodeLabels.length,
        totalRelationships: relTypes.length,
        indexes: JSON.stringify(indexes),
        constraints: JSON.stringify(constraints),
      }
    );
  },

  async _buildLocalSchema(
    nodeLabels,
    relTypes,
    indexes,
    constraints,
    timestamp,
    schemaVersion
  ) {
    const schema = {
      version: schemaVersion,
      timestamp,
      description: "Complete schema generated from database",
      node_types: [],
      indexes,
      constraints,
    };

    // Build node types
    for (const label of nodeLabels) {
      const properties = await this._extractNodeProperties(
        label,
        indexes,
        constraints
      );
      const nodeType = {
        label,
        description: `Node type for label ${label} - Generated from database schema`,
        attributes: properties,
        relationships: {},
      };
      schema.node_types.push(nodeType);
    }

    // Add relationships
    for (const relType of relTypes) {
      const relPairs = await Neo4jConnection.executeQuery(
        `MATCH (a)-[r:\`${relType}\`]->(b) 
         RETURN DISTINCT labels(a)[0] AS sourceLabel, labels(b)[0] AS targetLabel`
      );

      for (const pair of relPairs) {
        const sourceNode = schema.node_types.find(
          (n) => n.label === pair.sourceLabel
        );
        if (sourceNode) {
          const relProperties = await this._extractRelationshipProperties(
            relType
          );
          sourceNode.relationships[relType] = {
            target: pair.targetLabel,
            description: `Relationship ${relType} to ${pair.targetLabel}`,
            properties: relProperties,
          };
        }
      }
    }

    return schema;
  },
};

// ===== MODULE: Cypher Export (Updated for property-only updates) =====
const CypherExport = {
  generatePropertyUpdateCypher(schema) {
    if (!schema) throw new Error("No schema to export");

    const cypherCommands = [];
    const timestamp = new Date().toISOString();

    cypherCommands.push(`// === migRaven Schema Property Updates ===`);
    cypherCommands.push(`// Generated: ${timestamp}`);
    cypherCommands.push(`// Version: ${schema.version || 1}`);
    cypherCommands.push(
      `// IMPORTANT: This script only updates node and relationship properties`
    );
    cypherCommands.push(`// It does NOT modify the graph structure\n`);

    // Update node properties
    schema.node_types.forEach((nodeType) => {
      cypherCommands.push(`\n// Update properties for ${nodeType.label} nodes`);

      // Create a MERGE query that updates properties without changing structure
      const properties = [];
      Object.entries(nodeType.attributes || {}).forEach(
        ([propName, propInfo]) => {
          if (propInfo.description && propInfo.description.trim()) {
            properties.push({
              name: propName,
              type: propInfo.type,
              description: propInfo.description,
            });
          }
        }
      );

      if (properties.length > 0) {
        cypherCommands.push(
          `// Update _migRaven_Schema node for ${nodeType.label}`
        );
        cypherCommands.push(
          `MATCH (schema:_migRaven_Schema {originalLabel: '${
            nodeType.label
          }', nodeType: 'node'})
SET schema.properties = '${JSON.stringify(properties).replace(/'/g, "\\'")}'
SET schema.description = '${(nodeType.description || "").replace(/'/g, "\\'")}'
SET schema.updatedAt = datetime()
RETURN schema.originalLabel AS updated;`
        );
      }

      // Update relationship properties
      Object.entries(nodeType.relationships || {}).forEach(
        ([relName, relInfo]) => {
          if (
            relInfo.description ||
            Object.keys(relInfo.properties || {}).length > 0
          ) {
            cypherCommands.push(
              `\n// Update _SCHEMA_RELATIONSHIP for ${nodeType.label}-[${relName}]->${relInfo.target}`
            );

            const relProperties = Object.entries(relInfo.properties || {}).map(
              ([propName, propInfo]) => ({
                name: propName,
                type: propInfo.type,
                description: propInfo.description || "",
              })
            );

            cypherCommands.push(
              `MATCH (source:_migRaven_Schema {originalLabel: '${
                nodeType.label
              }', nodeType: 'node'})
      -[rel:_SCHEMA_RELATIONSHIP {originalType: '${relName}'}]->
      (target:_migRaven_Schema {originalLabel: '${
        relInfo.target
      }', nodeType: 'node'})
SET rel.properties = '${JSON.stringify(relProperties).replace(/'/g, "\\'")}'
SET rel.description = '${(relInfo.description || "").replace(/'/g, "\\'")}'
SET rel.updatedAt = datetime()
RETURN rel.originalType AS updated;`
            );
          }
        }
      );
    });

    // Add validation query
    cypherCommands.push(`\n// === Validation Query ===`);
    cypherCommands.push(`// Run this to verify the updates:`);
    cypherCommands.push(
      `MATCH (n:_migRaven_Schema)
RETURN n.nodeType AS type, n.originalLabel AS label, n.description AS description
ORDER BY n.nodeType, n.originalLabel;`
    );

    return cypherCommands.join("\n");
  },
};

// ===== MODULE: UI Manager =====
const UIManager = {
  updateModifiedStatus(modified) {
    SchemaEditorState.isModified = modified;
    const indicator = document.getElementById("modifiedIndicator");
    if (indicator) {
      indicator.style.display = modified ? "inline" : "none";
    }

    if (modified && SchemaEditorState.schemaData) {
      SchemaEditorState.schemaData.timestamp = new Date().toISOString();
    }

    this.updateButtonStates();
  },

  updateButtonStates() {
    const hasSchema = !!SchemaEditorState.schemaData;
    const isConnected = SchemaEditorConfig.neo4j.connected;
    const isModified = SchemaEditorState.isModified;

    const buttons = {
      downloadBtn: hasSchema,
      cypherBtn: hasSchema,
      saveToDbBtn: hasSchema && isModified,
      loadFromDbBtn: isConnected,
      generateSchemaBtn: isConnected,
      compareBtn: hasSchema && isConnected,
    };

    Object.entries(buttons).forEach(([id, enabled]) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    });
  },

  showConnectionStatus(message, type = "info") {
    const statusDiv = document.getElementById("connectionStatus");
    if (!statusDiv) return;

    statusDiv.style.display = "block";
    const classMap = {
      success: "connection-success",
      error: "connection-error",
      warning: "connection-warning",
      info: "connection-warning",
    };

    statusDiv.innerHTML = `<div class="${classMap[type]}">${message}</div>`;
  },

  updateSchemaInfo(source, version, timestamp, suffix = "") {
    const infoDiv = document.getElementById("currentSchemaInfo");
    if (infoDiv) {
      infoDiv.style.display = "block";
      document.getElementById("schemaSource").textContent = source + suffix;
      document.getElementById("schemaVersion").textContent =
        version !== undefined ? version : "N/A";
      document.getElementById("schemaTimestamp").textContent =
        timestamp || "N/A";
    }
  },
};

// Export modules for use in main script
window.SchemaEditorModules = {
  Config: SchemaEditorConfig,
  State: SchemaEditorState,
  Progress: ProgressManager,
  Error: ErrorHandler,
  Changes: ChangeTracker,
  Connection: Neo4jConnection,
  Operations: SchemaOperations,
  Cypher: CypherExport,
  UI: UIManager,
};
