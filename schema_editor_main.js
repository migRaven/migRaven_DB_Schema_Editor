// Schema Editor Main Script - Refactored Version
// This file uses the modular components from schema_editor_modules.js

// Get module references
const Modules = window.SchemaEditorModules;
const {
  Config,
  State,
  Progress,
  Error: ErrorModule,
  Changes,
  Connection,
  Operations,
  Cypher,
  UI,
  Logging,
} = Modules;

// ===== INITIALIZATION =====
document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM fully loaded - Initializing Schema Editor");

  // Show logging info
  console.log(
    "%c📊 Cypher Query Logging is ENABLED by default",
    "color: #0080ff; font-weight: bold"
  );
  console.log("%cUse these commands in the console:", "color: #666666");
  console.log("  CypherLogging.disable()     - Disable query logging");
  console.log("  CypherLogging.enable()      - Enable query logging");
  console.log("  CypherLogging.toggle()      - Toggle query logging");
  console.log("  CypherLogging.enableResults() - Show query results");
  console.log("  CypherLogging.status()      - Show current settings");

  // Initialize all event listeners
  initializeEventListeners();

  // Initialize UI state
  UI.updateButtonStates();
  Changes.updateChangeIndicator();
});

function initializeEventListeners() {
  // File operations
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileLoad);
  }

  // Search functionality
  const searchBox = document.getElementById("searchBox");
  if (searchBox) {
    searchBox.addEventListener("input", filterNodes);
  }

  // Neo4j connection
  const testConnectionBtn = document.getElementById("testConnectionBtn");
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener("click", testConnection);
  }

  const toggleConfigBtn = document.getElementById("toggleConfigBtn");
  if (toggleConfigBtn) {
    toggleConfigBtn.addEventListener("click", toggleNeo4jConfig);
  }

  // Schema operations buttons
  const buttonHandlers = {
    loadJSONBtn: () => document.getElementById("fileInput").click(),
    loadFromDbBtn: loadSchemaFromNeo4j,
    downloadBtn: downloadSchema,
    saveToDbBtn: saveSchemaToNeo4j,
    cypherBtn: exportToCypher,
    compareBtn: compareWithDbSchema,
    generateSchemaBtn: generateSchemaFromDb,
  };

  Object.entries(buttonHandlers).forEach(([id, handler]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", handler);
    }
  });

  // Modal handlers
  const modalHandlers = {
    closeCypherModalBtn: closeCypherModal,
    cancelCypherBtn: closeCypherModal,
    confirmCypherBtn: confirmCypherExport,
  };

  Object.entries(modalHandlers).forEach(([id, handler]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", handler);
    }
  });
}

// ===== UI FUNCTIONS =====
function toggleNeo4jConfig() {
  const detailsDiv = document.getElementById("neo4jConfigDetails");
  const indicator = document.getElementById("configToggleIndicator");
  const testConnectionBtn = document.getElementById("testConnectionBtn");

  if (detailsDiv.style.display === "none") {
    detailsDiv.style.display = "block";
    indicator.textContent = "(-)";
    testConnectionBtn.style.display = "inline-block";
  } else {
    detailsDiv.style.display = "none";
    indicator.textContent = "(+)";
    testConnectionBtn.style.display = "none";
  }
}

// ===== CONNECTION MANAGEMENT =====
async function testConnection() {
  const url = document.getElementById("neo4jUrl").value;
  const username = document.getElementById("neo4jUser").value;
  const password = document.getElementById("neo4jPassword").value;
  const database = document.getElementById("neo4jDatabase").value.trim();

  UI.showConnectionStatus("🔄 Testing connection...", "info");

  try {
    await Connection.connect(url, username, password, database);

    UI.showConnectionStatus(
      `✅ Connection successful! (DB: ${database || "default"})`,
      "success"
    );

    UI.updateButtonStates();

    // Auto-minimize config on success
    const configDetails = document.getElementById("neo4jConfigDetails");
    if (configDetails.style.display !== "none") {
      toggleNeo4jConfig();
    }
  } catch (error) {
    ErrorModule.handleError(
      error,
      "Neo4j Connection",
      "Failed to connect to Neo4j"
    );
    UI.showConnectionStatus(`❌ Connection failed: ${error.message}`, "error");
    UI.updateButtonStates();
  }
}

// ===== FILE OPERATIONS =====
async function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    await Operations.loadFromFile(file);

    renderTreeView();
    updateStats();
    UI.updateSchemaInfo(
      "JSON File",
      State.schemaData.version,
      State.schemaData.timestamp
    );
    UI.updateModifiedStatus(State.isModified);

    document.getElementById("statsBar").style.display = "flex";
    document.getElementById("comparisonResults").style.display = "none";

    // Auto-select first node if available
    if (State.schemaData.node_types && State.schemaData.node_types.length > 0) {
      // Clear details container first
      const detailsContainer = document.getElementById("detailsContainer");
      if (detailsContainer) {
        detailsContainer.innerHTML = "";
      }

      setTimeout(() => {
        console.log("🎯 Auto-selecting first node after file load");
        console.log(
          `   DOM ready check - Tree nodes: ${
            document.querySelectorAll(".node-header").length
          }`
        );
        console.log(`   Schema nodes: ${State.schemaData.node_types.length}`);

        selectNode(0);
      }, 150);
    }
  } catch (error) {
    ErrorModule.handleError(error, "File Load", "Error loading JSON file");
  }
}

async function downloadSchema() {
  try {
    const result = Operations.saveToFile();
    UI.updateSchemaInfo("JSON File (Saved)", result.version, result.timestamp);
    UI.updateModifiedStatus(false);
  } catch (error) {
    ErrorModule.handleError(error, "File Save", "Error saving schema");
  }
}

// ===== DATABASE OPERATIONS =====
async function generateSchemaFromDb() {
  try {
    const schema = await Operations.generateFromDatabase();

    State.localSchemaFilePath = `generated_schema_v${schema.version}.json`;

    renderTreeView();
    updateStats();
    UI.updateSchemaInfo("Generated from DB", schema.version, schema.timestamp);
    UI.updateModifiedStatus(false);

    if (schema.node_types.length > 0) {
      selectNode(0);
    }

    document.getElementById("statsBar").style.display = "flex";

    const stats = `
Schema generation complete!
• ${schema.node_types.length} node types
• ${schema.node_types.reduce(
      (sum, nt) => sum + Object.keys(nt.relationships || {}).length,
      0
    )} relationship types
• ${schema.node_types.reduce(
      (sum, nt) => sum + Object.keys(nt.attributes || {}).length,
      0
    )} total properties
• ${schema.indexes.length} indexes
• ${schema.constraints.length} constraints
    `.trim();

    alert(stats);
  } catch (error) {
    ErrorModule.handleError(
      error,
      "Schema Generation",
      "Failed to generate schema from database"
    );
  }
}

async function loadSchemaFromNeo4j() {
  const operationId = "loadSchema";
  Progress.start(operationId, 4, "Loading schema from database");

  try {
    // Check for existing schema
    Progress.update(operationId, 1, "Checking for existing schema");
    const checkResult = await Connection.executeQuery(
      `MATCH (n:_migRaven_Schema) 
       RETURN count(n) AS nodeCount, 
              max(n.schemaVersion) AS latestVersion,
              max(n.timestamp) AS latestTimestamp`
    );

    if (!checkResult.length || checkResult[0].nodeCount === 0) {
      Progress.complete(operationId);
      alert(
        'No _migRaven_Schema nodes found. Use "Generate Schema from DB" first.'
      );
      return;
    }

    const latestVersion = checkResult[0].latestVersion || 1;
    const latestTimestamp = checkResult[0].latestTimestamp;

    // Load metadata
    Progress.update(operationId, 2, "Loading schema metadata");
    const metaResult = await Connection.executeQuery(
      `MATCH (meta:_migRaven_Schema {nodeType: 'metadata'}) 
       WHERE meta.schemaVersion = $version
       RETURN *`,
      { version: latestVersion }
    );

    // Load nodes
    Progress.update(operationId, 3, "Loading node definitions");

    // First, let's check what's actually in the database
    const testQuery = await Connection.executeQuery(
      `MATCH (n:_migRaven_Schema {nodeType: 'node'}) 
       WHERE n.schemaVersion = $version
       RETURN n
       LIMIT 1`,
      { version: latestVersion }
    );

    if (testQuery.length > 0) {
      console.log(
        "%c🔍 Sample Node from DB:",
        "color: #ff00ff; font-weight: bold"
      );
      console.log("Full node data:", testQuery[0].n);
      console.log("Properties field:", testQuery[0].n.properties);
    }

    const nodeResult = await Connection.executeQuery(
      `MATCH (n:_migRaven_Schema {nodeType: 'node'}) 
       WHERE n.schemaVersion = $version
       RETURN n
       ORDER BY n.originalLabel`,
      { version: latestVersion }
    );

    // Load relationships
    Progress.update(operationId, 4, "Loading relationships");
    const relResult = await Connection.executeQuery(
      `MATCH (source:_migRaven_Schema {nodeType: 'node'})-[r:_SCHEMA_RELATIONSHIP]->(target:_migRaven_Schema {nodeType: 'node'})
       WHERE r.schemaVersion = $version
       RETURN source, target, r`,
      { version: latestVersion }
    );

    // Debug: Log raw node data
    console.log(
      "%c📥 Raw Node Data from DB:",
      "color: #0080ff; font-weight: bold"
    );
    nodeResult.forEach((record, idx) => {
      const node = record.n;
      console.log(`Node ${idx}: ${node.originalLabel}`);
      console.log("  Full node:", node);
      console.log("  Raw properties:", node.properties);
      console.log("  Properties type:", typeof node.properties);
      console.log(
        "  Properties length:",
        node.properties ? node.properties.length : 0
      );
    });

    // Build schema object
    const nodeTypes = [];
    for (const record of nodeResult) {
      const node = record.n;
      let properties;
      try {
        properties = JSON.parse(node.properties || "{}");
        console.log(
          `✅ Parsed properties for ${node.originalLabel}:`,
          properties
        );
      } catch (e) {
        console.error(
          `❌ Failed to parse properties for ${node.originalLabel}:`,
          e
        );
        properties = {};
      }
      const attributes = {};

      // Properties should always be an object
      if (typeof properties === "object" && !Array.isArray(properties)) {
        for (const [propName, propInfo] of Object.entries(properties)) {
          attributes[propName] = {
            type: propInfo.type || "string",
            indexed: propInfo.indexed || false,
            unique: propInfo.unique || false,
            description: propInfo.description || "",
          };
        }
      } else if (Array.isArray(properties)) {
        // Handle legacy array format
        console.warn(
          `Legacy array format detected for node ${node.label}, converting to object format`
        );
        for (const prop of properties) {
          attributes[prop.name] = {
            type: prop.type || "string",
            indexed: prop.indexed || false,
            unique: prop.unique || false,
            description: prop.description || "",
          };
        }
      }

      const nodeData = {
        label: node.originalLabel,
        description: node.description || "",
        attributes,
        relationships: {},
      };

      console.log(`📦 Built node data for ${node.originalLabel}:`);
      console.log(`  - Attributes count: ${Object.keys(attributes).length}`);
      console.log(`  - Attribute names: ${Object.keys(attributes).join(", ")}`);

      nodeTypes.push(nodeData);
    }

    // Add relationships to nodes
    console.log(
      "%c📥 Processing Relationships:",
      "color: #ff6600; font-weight: bold"
    );
    for (const record of relResult) {
      const source = record.source;
      const target = record.target;
      const rel = record.r;

      console.log(
        `  Relationship: ${source.originalLabel} -[${rel.originalType}]-> ${target.originalLabel}`
      );

      const sourceNode = nodeTypes.find(
        (n) => n.label === source.originalLabel
      );
      if (sourceNode) {
        const parsedProps = rel.properties ? JSON.parse(rel.properties) : {};
        let propObject = {};

        // Properties should be an object
        if (typeof parsedProps === "object" && !Array.isArray(parsedProps)) {
          propObject = parsedProps;
        } else if (Array.isArray(parsedProps)) {
          // Handle legacy array format
          console.warn(
            `Legacy array format detected for relationship ${rel.originalType}, converting to object format`
          );
          for (const prop of parsedProps) {
            propObject[prop.name] = {
              type: prop.type || "string",
              description: prop.description || "",
            };
          }
        }

        sourceNode.relationships[rel.originalType] = {
          target: target.originalLabel,
          description: rel.description || "",
          properties: propObject,
        };
      } else {
        console.error(
          `Source node ${source.originalLabel} not found in nodeTypes!`
        );
      }
    }

    const loadedSchema = {
      version: latestVersion,
      timestamp: latestTimestamp || new Date().toISOString(),
      description: "Schema loaded from _migRaven_Schema nodes",
      node_types: nodeTypes,
    };

    // Final debug check
    console.log(
      "%c📊 Final Schema Structure:",
      "color: #00ff00; font-weight: bold"
    );
    console.log(`Total nodes: ${loadedSchema.node_types.length}`);
    loadedSchema.node_types.slice(0, 3).forEach((node, idx) => {
      console.log(`Node ${idx}: ${node.label}`);
      console.log(
        `  - Attributes: ${Object.keys(node.attributes || {}).length}`
      );
      console.log(
        `  - First 3 attributes:`,
        Object.entries(node.attributes || {})
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${v.type}`)
      );
      console.log(
        `  - Relationships: ${Object.keys(node.relationships || {}).length}`
      );
    });

    State.schemaData = loadedSchema;
    State.isModified = false;
    State.currentNode = null; // Reset current node selection
    State.dbSchemaInfo = {
      version: latestVersion,
      timestamp: latestTimestamp,
      metaId: "_migRaven_Schema_Loaded",
    };

    // Debug: Log loaded schema details
    console.log(
      "%c🔍 Loaded Schema Details:",
      "color: #ff6600; font-weight: bold"
    );
    loadedSchema.node_types.forEach((node, index) => {
      console.log(`Node ${index}: ${node.label}`);
      console.log(`  - Description: "${node.description || "EMPTY"}"`);
      console.log(
        `  - Attributes: ${Object.keys(node.attributes || {}).length}`
      );
      console.log(
        `  - Relationships: ${Object.keys(node.relationships || {}).length}`
      );

      // Log first few attributes
      Object.entries(node.attributes || {})
        .slice(0, 3)
        .forEach(([attrName, attr]) => {
          console.log(
            `    • ${attrName}: ${attr.type} ${
              attr.description ? `- ${attr.description}` : ""
            }`
          );
        });

      // Log relationships
      Object.entries(node.relationships || {}).forEach(([relName, rel]) => {
        console.log(
          `    → ${relName} to ${rel.target} - "${rel.description || "EMPTY"}"`
        );
      });
    });

    renderTreeView();
    updateStats();
    UI.updateSchemaInfo(
      "Database (_migRaven_Schema)",
      latestVersion,
      latestTimestamp
    );
    UI.updateModifiedStatus(false);

    document.getElementById("statsBar").style.display = "flex";

    // Ensure DOM is ready before selecting node
    if (nodeTypes.length > 0) {
      // Clear details container first
      const detailsContainer = document.getElementById("detailsContainer");
      if (detailsContainer) {
        detailsContainer.innerHTML = "";
      }

      setTimeout(() => {
        console.log("🎯 Auto-selecting first node after schema load");
        console.log(
          `   DOM ready check - Tree nodes: ${
            document.querySelectorAll(".node-header").length
          }`
        );
        console.log(`   Schema nodes: ${nodeTypes.length}`);

        selectNode(0);

        // Force a re-render if needed
        setTimeout(() => {
          const activeHeaders = document.querySelectorAll(
            ".node-header.active"
          );
          if (activeHeaders.length === 0 && State.currentNode === 0) {
            console.warn("⚠️ No active node found, forcing re-render");
            renderNodeDetails(State.schemaData.node_types[0]);
          }
        }, 200);
      }, 150);
    }

    Progress.complete(operationId);
    UI.showConnectionStatus(
      `✅ Schema loaded: ${nodeTypes.length} nodes, ${relResult.length} relationships`,
      "success"
    );
  } catch (error) {
    Progress.complete(operationId);
    ErrorModule.handleError(
      error,
      "Load Schema",
      "Failed to load schema from database"
    );
  }
}

async function saveSchemaToNeo4j() {
  if (!State.schemaData) {
    alert("No schema to save.");
    return;
  }

  if (
    !State.isModified &&
    State.dbSchemaInfo?.version === State.schemaData.version
  ) {
    alert("No changes to save.");
    return;
  }

  // Check if only property descriptions were changed
  const changeCount = Changes.getChangeCount();
  const hasOnlyPropertyChanges = changeCount > 0 && State.isModified;

  if (
    hasOnlyPropertyChanges &&
    State.dbSchemaInfo?.version === State.schemaData.version
  ) {
    // Only update properties without changing schema structure
    const confirm = window.confirm(
      "Only property descriptions have changed. Update properties without creating a new schema version?"
    );

    if (confirm) {
      await updatePropertiesToNeo4j();
      return;
    }
  }

  const operationId = "saveSchema";
  Progress.start(operationId, 5, "Saving schema to database");

  try {
    // Increment version if modified
    if (State.isModified || !State.schemaData.version) {
      State.schemaData.version = (State.schemaData.version || 0) + 1;
      State.schemaData.timestamp = new Date().toISOString();
    }

    const { version, timestamp } = State.schemaData;

    // Step 1: Check existing schema
    Progress.update(operationId, 1, "Checking existing schema versions");
    const existingResult = await Connection.executeQuery(
      `MATCH (n:_migRaven_Schema) 
       RETURN count(n) AS nodeCount, 
              max(n.schemaVersion) AS maxVersion`
    );

    const isInitialSave =
      !existingResult.length || existingResult[0].nodeCount === 0;

    if (!isInitialSave && existingResult[0].maxVersion > version) {
      Progress.complete(operationId);
      const proceed = confirm(
        `WARNING: Database schema (v${existingResult[0].maxVersion}) is newer than local (v${version}). Overwrite?`
      );
      if (!proceed) return;
    }

    // Step 2: Clear existing schema
    Progress.update(operationId, 2, "Clearing existing schema nodes");
    await Connection.executeQuery("MATCH (n:_migRaven_Schema) DETACH DELETE n");

    // Step 3: Create nodes
    Progress.update(
      operationId,
      3,
      `Creating ${State.schemaData.node_types.length} schema nodes`
    );
    const migRavenNodes = new Map();

    for (const nodeType of State.schemaData.node_types) {
      // Debug: Log what we're saving
      console.log(
        `💾 Saving Node: ${nodeType.label} - Description: "${
          nodeType.description || "EMPTY"
        }"`
      );

      const properties = {};
      for (const [attrName, attrInfo] of Object.entries(
        nodeType.attributes || {}
      )) {
        properties[attrName] = {
          type: attrInfo.type || "string",
          indexed: attrInfo.indexed || false,
          unique: attrInfo.unique || false,
          description: attrInfo.description || "",
        };
      }

      const result = await Connection.executeQuery(
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
          originalLabel: nodeType.label,
          description: nodeType.description || "",
          properties: JSON.stringify(properties),
          timestamp,
          schemaVersion: version,
        }
      );

      if (result.length > 0) {
        migRavenNodes.set(nodeType.label, result[0].nodeId);
      }
    }

    // Step 4: Create relationships
    Progress.update(operationId, 4, "Creating schema relationships");
    for (const nodeType of State.schemaData.node_types) {
      for (const [relName, relInfo] of Object.entries(
        nodeType.relationships || {}
      )) {
        if (
          !migRavenNodes.has(nodeType.label) ||
          !migRavenNodes.has(relInfo.target)
        ) {
          continue;
        }

        const relProperties = {};
        for (const [propName, propInfo] of Object.entries(
          relInfo.properties || {}
        )) {
          relProperties[propName] = {
            type: propInfo.type || "string",
            description: propInfo.description || "",
          };
        }

        await Connection.executeQuery(
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
            sourceId: migRavenNodes.get(nodeType.label),
            targetId: migRavenNodes.get(relInfo.target),
            originalType: relName,
            properties: JSON.stringify(relProperties),
            description: relInfo.description || "",
            timestamp,
            schemaVersion: version,
          }
        );
      }
    }

    // Step 5: Create metadata
    Progress.update(operationId, 5, "Creating schema metadata");
    await Connection.executeQuery(
      `CREATE (meta:_migRaven_Schema {
        nodeType: 'metadata',
        schemaVersion: $schemaVersion,
        timestamp: $timestamp,
        totalNodes: $totalNodes,
        totalRelationships: $totalRelationships,
        originalSchemaData: $originalSchemaData,
        schemaId: $schemaId
      })`,
      {
        schemaVersion: version,
        timestamp,
        totalNodes: migRavenNodes.size,
        totalRelationships: 0,
        originalSchemaData: JSON.stringify(State.schemaData),
        schemaId: Config.constants.GLOBAL_SCHEMA_META_ID,
      }
    );

    Progress.complete(operationId);

    State.dbSchemaInfo = {
      version,
      timestamp,
      metaId: Config.constants.GLOBAL_SCHEMA_META_ID,
    };
    UI.updateModifiedStatus(false);
    UI.updateSchemaInfo("Neo4j DB (_migRaven_Schema)", version, timestamp);
    UI.showConnectionStatus(
      `✅ Schema saved to database (Version ${version})`,
      "success"
    );
  } catch (error) {
    Progress.complete(operationId);
    ErrorModule.handleError(
      error,
      "Save Schema",
      "Failed to save schema to database"
    );
  }
}

// ===== PROPERTY UPDATE FUNCTION =====
async function updatePropertiesToNeo4j() {
  if (!State.schemaData) {
    alert("No schema loaded.");
    return;
  }

  if (!Config.neo4j.connected) {
    alert("Not connected to Neo4j. Please test connection first.");
    return;
  }

  const operationId = "updateProperties";
  Progress.start(operationId, 2, "Updating properties in database");

  try {
    Progress.update(operationId, 1, "Applying property updates");

    const results = await Cypher.applyPropertyUpdatesToNeo4j(State.schemaData);

    Progress.update(operationId, 2, "Update complete");
    Progress.complete(operationId);

    let message = `✅ Properties updated successfully!\n`;
    message += `Nodes updated: ${results.nodesUpdated}\n`;
    message += `Relationships updated: ${results.relationshipsUpdated}`;

    if (results.errors.length > 0) {
      message += `\n\n⚠️ Errors:\n${results.errors.join("\n")}`;
    }

    alert(message);
    UI.showConnectionStatus("✅ Properties updated in database", "success");
  } catch (error) {
    Progress.complete(operationId);
    ErrorModule.handleError(
      error,
      "Update Properties",
      "Failed to update properties in database"
    );
  }
}

// ===== COMPARISON FUNCTIONS =====
async function compareWithDbSchema() {
  if (!State.schemaData) {
    alert("Load a schema first to compare.");
    return;
  }

  const comparisonDiv = document.getElementById("comparisonResults");
  const comparisonText = document.getElementById("comparisonText");
  comparisonDiv.style.display = "block";
  comparisonText.innerHTML = "🔄 Analyzing database structure...";

  try {
    // First, get the actual database structure
    const actualDbStructure = await analyzeActualDatabase();

    // Compare with current schema
    const differences = compareSchemaWithActual(
      State.schemaData,
      actualDbStructure
    );

    // Display differences
    displaySchemaDifferences(differences, comparisonText);
  } catch (error) {
    ErrorModule.handleError(
      error,
      "Schema Comparison",
      "Failed to compare schemas"
    );
    comparisonText.innerHTML = `❌ Error: ${error.message}`;
  }
}

// Analyze the actual database structure
async function analyzeActualDatabase() {
  const operationId = "analyzeDb";
  Progress.start(operationId, 4, "Analyzing database structure");

  try {
    // Step 1: Get all node labels
    Progress.update(operationId, 1, "Fetching node labels");
    const labelsResult = await Connection.executeQuery(
      `CALL db.labels() YIELD label 
       WHERE NOT (label STARTS WITH '_' OR label STARTS WITH 'p')
       RETURN collect(label) AS labels`
    );
    const labels = labelsResult[0]?.labels || [];

    // Step 2: Get node properties for each label
    Progress.update(operationId, 2, "Analyzing node properties");
    const nodeStructure = {};

    for (const label of labels) {
      // Get property keys and sample values
      const propsResult = await Connection.executeQuery(
        `MATCH (n:\`${label}\`)
         WITH n LIMIT 100
         WITH keys(n) AS propKeys
         UNWIND propKeys AS key
         RETURN DISTINCT key
         ORDER BY key`
      );

      const properties = {};
      for (const row of propsResult) {
        const propKey = row.key;

        // Get property type - simplified approach
        let propertyType = "string"; // default
        try {
          const sampleResult = await Connection.executeQuery(
            `MATCH (n:\`${label}\`)
             WHERE n[$propKey] IS NOT NULL
             RETURN n[$propKey] AS value
             LIMIT 1`,
            { propKey: propKey }
          );

          if (sampleResult.length > 0) {
            const sampleValue = sampleResult[0].value;
            // Determine type based on JavaScript type
            if (typeof sampleValue === "number") {
              propertyType = Number.isInteger(sampleValue)
                ? "integer"
                : "float";
            } else if (typeof sampleValue === "boolean") {
              propertyType = "boolean";
            } else if (Array.isArray(sampleValue)) {
              propertyType = "array";
            } else if (sampleValue instanceof Date) {
              propertyType = "datetime";
            } else {
              propertyType = "string";
            }
          }
        } catch (e) {
          console.warn(
            `Could not determine type for ${label}.${propKey}:`,
            e.message
          );
        }

        properties[propKey] = {
          type: propertyType,
          indexed: false, // Will check indexes separately
          unique: false,
          description: "",
        };
      }

      nodeStructure[label] = {
        label: label,
        properties: properties,
        relationships: {},
      };
    }

    // Step 3: Get relationships
    Progress.update(operationId, 3, "Analyzing relationships");
    const relsResult = await Connection.executeQuery(
      `CALL db.relationshipTypes() YIELD relationshipType
       WHERE NOT (relationshipType STARTS WITH '_' OR relationshipType STARTS WITH 'p')
       RETURN collect(relationshipType) AS types`
    );
    const relTypes = relsResult[0]?.types || [];

    // Get relationship details
    for (const relType of relTypes) {
      const relDetailsResult = await Connection.executeQuery(
        `MATCH (a)-[r:\`${relType}\`]->(b)
         WITH labels(a)[0] AS sourceLabel, labels(b)[0] AS targetLabel, r
         WHERE NOT (sourceLabel STARTS WITH '_' OR sourceLabel STARTS WITH 'p' 
                OR targetLabel STARTS WITH '_' OR targetLabel STARTS WITH 'p')
       
         RETURN DISTINCT sourceLabel, targetLabel, keys(r) AS propKeys`
      );

      for (const detail of relDetailsResult) {
        if (nodeStructure[detail.sourceLabel]) {
          nodeStructure[detail.sourceLabel].relationships[relType] = {
            target: detail.targetLabel,
            properties: {},
            description: "",
          };

          // Add relationship properties
          for (const propKey of detail.propKeys || []) {
            nodeStructure[detail.sourceLabel].relationships[relType].properties[
              propKey
            ] = {
              type: "string",
              description: "",
            };
          }
        }
      }
    }

    // Step 4: Check indexes
    Progress.update(operationId, 4, "Checking indexes");
    try {
      const indexResult = await Connection.executeQuery(
        `SHOW INDEXES YIELD name, labelsOrTypes, properties, type
         WHERE type IN ['BTREE', 'RANGE']
         RETURN labelsOrTypes, properties`
      );

      for (const idx of indexResult) {
        const label = idx.labelsOrTypes[0];
        const prop = idx.properties[0];
        if (nodeStructure[label] && nodeStructure[label].properties[prop]) {
          nodeStructure[label].properties[prop].indexed = true;
        }
      }
    } catch (indexError) {
      // SHOW INDEXES might not be supported in older Neo4j versions
      console.warn("Could not retrieve index information:", indexError.message);
      // Try alternative method for older versions
      try {
        const constraintsResult = await Connection.executeQuery(
          `CALL db.constraints() YIELD description
           RETURN description`
        );
        // Parse constraints to find indexed properties
        for (const row of constraintsResult) {
          const desc = row.description;
          // Extract label and property from constraint description
          const match = desc.match(/\((\w+):(\w+)\)/);
          if (match) {
            const [, varName, label] = match;
            const propMatch = desc.match(/\.(\w+)\s+IS\s+UNIQUE/);
            if (
              propMatch &&
              nodeStructure[label] &&
              nodeStructure[label].properties[propMatch[1]]
            ) {
              nodeStructure[label].properties[propMatch[1]].indexed = true;
              nodeStructure[label].properties[propMatch[1]].unique = true;
            }
          }
        }
      } catch (e) {
        console.warn("Could not retrieve constraint information:", e.message);
      }
    }

    Progress.complete(operationId);
    return nodeStructure;
  } catch (error) {
    Progress.complete(operationId);
    throw error;
  }
}

// Compare schema with actual database
function compareSchemaWithActual(schema, actualDb) {
  const differences = {
    missingInSchema: {
      nodes: [],
      relationships: [],
      properties: [],
    },
    missingInDb: {
      nodes: [],
      relationships: [],
      properties: [],
    },
    typeMismatches: [],
  };

  // Create maps for easier lookup
  const schemaNodes = new Map();
  schema.node_types.forEach((node) => {
    schemaNodes.set(node.label, node);
  });

  // Check what's in DB but not in schema
  for (const [label, dbNode] of Object.entries(actualDb)) {
    const schemaNode = schemaNodes.get(label);

    if (!schemaNode) {
      // Entire node is missing in schema
      differences.missingInSchema.nodes.push({
        label: label,
        properties: Object.keys(dbNode.properties),
        relationships: Object.keys(dbNode.relationships),
      });
    } else {
      // Check properties
      for (const [propName, propInfo] of Object.entries(dbNode.properties)) {
        if (!schemaNode.attributes[propName]) {
          differences.missingInSchema.properties.push({
            node: label,
            property: propName,
            type: propInfo.type,
          });
        }
      }

      // Check relationships
      for (const [relName, relInfo] of Object.entries(dbNode.relationships)) {
        if (!schemaNode.relationships[relName]) {
          differences.missingInSchema.relationships.push({
            source: label,
            type: relName,
            target: relInfo.target,
          });
        }
      }
    }
  }

  // Check what's in schema but not in DB
  for (const schemaNode of schema.node_types) {
    if (!actualDb[schemaNode.label]) {
      differences.missingInDb.nodes.push({
        label: schemaNode.label,
      });
    }
  }

  return differences;
}

// Display schema differences
function displaySchemaDifferences(differences, container) {
  let html = '<div class="comparison-results">';

  const totalDiffs =
    differences.missingInSchema.nodes.length +
    differences.missingInSchema.relationships.length +
    differences.missingInSchema.properties.length +
    differences.missingInDb.nodes.length;

  if (totalDiffs === 0) {
    html +=
      '<p style="color: #28a745;">✅ Schema is in sync with database!</p>';
  } else {
    html += `<h3>Found ${totalDiffs} differences:</h3>`;

    // Missing in schema (found in DB)
    if (differences.missingInSchema.nodes.length > 0) {
      html += '<div class="diff-section">';
      html +=
        '<h4 style="color: #dc3545;">🆕 New nodes found in database:</h4>';
      html += "<ul>";
      differences.missingInSchema.nodes.forEach((node) => {
        html += `<li><strong>${node.label}</strong> (${node.properties.length} properties, ${node.relationships.length} relationships)</li>`;
      });
      html += "</ul>";
      html += "</div>";
    }

    if (differences.missingInSchema.relationships.length > 0) {
      html += '<div class="diff-section">';
      html +=
        '<h4 style="color: #dc3545;">🔗 New relationships found in database:</h4>';
      html += "<ul>";
      differences.missingInSchema.relationships.forEach((rel) => {
        html += `<li>${rel.source} -[${rel.type}]-> ${rel.target}</li>`;
      });
      html += "</ul>";
      html += "</div>";
    }

    if (differences.missingInSchema.properties.length > 0) {
      html += '<div class="diff-section">';
      html +=
        '<h4 style="color: #dc3545;">📋 New properties found in database:</h4>';
      html += "<ul>";
      differences.missingInSchema.properties.forEach((prop) => {
        html += `<li>${prop.node}.${prop.property} (${prop.type})</li>`;
      });
      html += "</ul>";
      html += "</div>";
    }

    // Add update button
    if (
      differences.missingInSchema.nodes.length > 0 ||
      differences.missingInSchema.relationships.length > 0 ||
      differences.missingInSchema.properties.length > 0
    ) {
      html += '<div style="margin-top: 20px;">';
      html +=
        '<button class="btn btn-primary" onclick="updateSchemaFromDb()">🔄 Update Schema with Database Changes</button>';
      html += "</div>";
    }
  }

  html += "</div>";
  container.innerHTML = html;

  // Store differences for update function
  window.pendingSchemaDifferences = differences;
}

// Update schema with database changes
async function updateSchemaFromDb() {
  if (!window.pendingSchemaDifferences) {
    alert("No differences to update.");
    return;
  }

  const diffs = window.pendingSchemaDifferences;
  const confirmMsg =
    `This will add to your schema:\n` +
    `- ${diffs.missingInSchema.nodes.length} new nodes\n` +
    `- ${diffs.missingInSchema.relationships.length} new relationships\n` +
    `- ${diffs.missingInSchema.properties.length} new properties\n\n` +
    `Continue?`;

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    // Re-analyze database to get full structure
    const actualDb = await analyzeActualDatabase();

    // Add missing nodes
    for (const missingNode of diffs.missingInSchema.nodes) {
      const dbNode = actualDb[missingNode.label];
      if (dbNode) {
        const attributes = {};
        for (const [propName, propInfo] of Object.entries(dbNode.properties)) {
          attributes[propName] = propInfo;
        }

        State.schemaData.node_types.push({
          label: dbNode.label,
          description: `Auto-discovered from database`,
          attributes: attributes,
          relationships: dbNode.relationships,
        });
      }
    }

    // Add missing properties
    for (const missingProp of diffs.missingInSchema.properties) {
      const schemaNode = State.schemaData.node_types.find(
        (n) => n.label === missingProp.node
      );
      if (schemaNode) {
        schemaNode.attributes[missingProp.property] = {
          type: missingProp.type,
          indexed: false,
          unique: false,
          description: "Auto-discovered from database",
        };
      }
    }

    // Add missing relationships
    for (const missingRel of diffs.missingInSchema.relationships) {
      const schemaNode = State.schemaData.node_types.find(
        (n) => n.label === missingRel.source
      );
      if (schemaNode) {
        const dbNode = actualDb[missingRel.source];
        if (dbNode && dbNode.relationships[missingRel.type]) {
          schemaNode.relationships[missingRel.type] =
            dbNode.relationships[missingRel.type];
        }
      }
    }

    // Update UI
    State.isModified = true;
    UI.updateModifiedStatus(true);
    renderTreeView();
    updateStats();

    // Clear comparison results
    document.getElementById("comparisonResults").style.display = "none";
    window.pendingSchemaDifferences = null;

    alert("✅ Schema updated with database changes!");
  } catch (error) {
    ErrorModule.handleError(
      error,
      "Schema Update",
      "Failed to update schema from database"
    );
  }
}

// ===== EXPORT FUNCTIONS =====
function exportToCypher() {
  if (!State.schemaData) {
    alert("No schema to export.");
    return;
  }

  try {
    const cypherQuery = Cypher.generatePropertyUpdateCypher(State.schemaData);
    State.lastCypherQueryForExport = cypherQuery;

    document.getElementById("cypherPreview").value = cypherQuery;
    document.getElementById("cypherModal").style.display = "block";
  } catch (error) {
    ErrorModule.handleError(
      error,
      "Cypher Export",
      "Failed to generate Cypher export"
    );
  }
}

function closeCypherModal() {
  document.getElementById("cypherModal").style.display = "none";
}

function confirmCypherExport() {
  if (!State.lastCypherQueryForExport) {
    alert("No Cypher query generated.");
    return;
  }

  const dataStr =
    "data:application/vnd.neo4j.cypher;charset=utf-8," +
    encodeURIComponent(State.lastCypherQueryForExport);

  const fileName = `migRaven_schema_properties_update_v${
    State.schemaData.version || "1"
  }.cypher`;

  const link = document.createElement("a");
  link.setAttribute("href", dataStr);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();

  closeCypherModal();
}

// ===== TREE VIEW RENDERING =====
function renderTreeView() {
  const container = document.getElementById("treeContainer");
  container.innerHTML = "";

  if (!State.schemaData?.node_types?.length) {
    container.innerHTML =
      '<div class="no-selection"><p>No node types found in schema.</p></div>';
    return;
  }

  State.schemaData.node_types.forEach((node, index) => {
    const nodeElement = createNodeElement(node, index);
    container.appendChild(nodeElement);
  });
}

function createNodeElement(node, index) {
  const div = document.createElement("div");
  div.className = "node-item";

  const attrCount = Object.keys(node.attributes || {}).length;
  const relCount = Object.keys(node.relationships || {}).length;
  const hasDescription = node.description && node.description.trim().length > 0;

  div.innerHTML = `
    <div class="node-header" onclick="selectNode(${index})" title="${
    node.description || "No description"
  }">
      <div class="node-label">
        ${node.label}
        ${
          hasDescription
            ? '<span style="color: #28a745; margin-left: 4px;" title="Has description">📝</span>'
            : ""
        }
      </div>
      <div class="node-stats">${attrCount} Attr. • ${relCount} Rel.</div>
    </div>
    ${
      hasDescription
        ? `<div class="node-description" style="font-size: 11px; color: #6c757d; padding: 2px 12px 8px 12px; font-style: italic;">${node.description.substring(
            0,
            50
          )}${node.description.length > 50 ? "..." : ""}</div>`
        : ""
    }
  `;

  return div;
}

function selectNode(index) {
  State.currentNode = index;
  const node = State.schemaData.node_types[index];

  console.log(`📌 Selecting node ${index}: ${node.label}`);
  console.log(`   - Description: "${node.description || "EMPTY"}"`);
  console.log(`   - Attributes: ${Object.keys(node.attributes || {}).length}`);
  console.log(
    `   - Relationships: ${Object.keys(node.relationships || {}).length}`
  );

  const headers = document.querySelectorAll(".node-header");
  if (headers.length === 0) {
    console.error("❌ No node headers found in DOM!");
    return;
  }

  headers.forEach((h) => h.classList.remove("active"));
  if (headers[index]) {
    headers[index].classList.add("active");
  } else {
    console.error(`❌ Node header at index ${index} not found!`);
  }

  renderNodeDetails(node);
  openTab(null, "NodeProperties");
}

// ===== NODE DETAILS RENDERING =====
function renderNodeDetails(node) {
  const container = document.getElementById("detailsContainer");
  container.innerHTML = "";

  // Create tabs
  const tabContainer = document.createElement("div");
  tabContainer.className = "tab-container";
  tabContainer.innerHTML = `
    <button class="tab-button active" id="tabButtonNodeProperties" onclick="openTab(event, 'NodeProperties')">
      Node Properties
    </button>
    <button class="tab-button" id="tabButtonNodeRelations" onclick="openTab(event, 'NodeRelations')">
      Relationships
    </button>
  `;
  container.appendChild(tabContainer);

  // Create tab content
  const nodePropsContent = createNodePropertiesTab(node);
  const nodeRelationsContent = createRelationshipsTab(node);

  container.appendChild(nodePropsContent);
  container.appendChild(nodeRelationsContent);
}

function createNodePropertiesTab(node) {
  const content = document.createElement("div");
  content.id = "NodeProperties";
  content.className = "tab-content active";

  let attributesHtml = "";
  Object.entries(node.attributes || {}).forEach(([name, attr]) => {
    attributesHtml += `
      <div class="attribute-item">
        <div class="attribute-name">${name}</div>
        <div class="attribute-details">
          <span>Type: ${attr.type}</span>
          <span>Indexed: ${attr.indexed ? "Yes" : "No"}</span>
          ${attr.unique ? "<span>Unique: Yes</span>" : ""}
        </div>
        <textarea class="form-control" placeholder="Attribute description..."
          onchange="updateAttributeDescription('${name}', this.value)"
          style="margin-top: 8px; min-height: 60px;">${
            attr.description || ""
          }</textarea>
        
        <div class="attribute-examples">
          <div class="examples-title">
            <span>Example Values:</span>
            <button class="btn btn-info btn-small" 
              onclick="loadAttributeExamples('${node.label}', '${name}')">
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

  content.innerHTML = `
    <div class="form-group">
      <label class="form-label">🏷️ Node Label</label>
      <input type="text" class="form-control" value="${node.label}" readonly>
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
        🔧 Node Attributes (${Object.keys(node.attributes || {}).length})
      </div>
      ${attributesHtml}
    </div>
  `;

  return content;
}

function createRelationshipsTab(node) {
  const content = document.createElement("div");
  content.id = "NodeRelations";
  content.className = "tab-content";

  let relationshipsHtml = "";
  Object.entries(node.relationships || {}).forEach(([name, rel]) => {
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
            🔩 Relationship Properties (${Object.keys(rel.properties).length})
            <button class="btn btn-success btn-small" onclick="addRelationshipProperty('${name}')">
              + Add Property
            </button>
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
            <button class="btn btn-info btn-small" 
              onclick="loadRelationshipExamples('${node.label}', '${name}', '${
      rel.target || ""
    }')">
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

  content.innerHTML = `
    <div class="relationships-section" style="margin-top:0; padding-top:0; border-top:none;">
      <div class="section-title">
        🔗 Relationships (${Object.keys(node.relationships || {}).length})
      </div>
      ${relationshipsHtml}
    </div>
  `;

  return content;
}

// ===== UPDATE FUNCTIONS WITH CHANGE TRACKING =====
function updateNodeDescription(description) {
  if (State.currentNode === null || !State.schemaData) return;

  const node = State.schemaData.node_types[State.currentNode];
  const oldValue = node.description;
  node.description = description;

  Changes.trackNodeChange(node.label, "description", oldValue, description);
  UI.updateModifiedStatus(true);
}

function updateAttributeDescription(attrName, description) {
  if (State.currentNode === null || !State.schemaData) return;

  const node = State.schemaData.node_types[State.currentNode];
  const oldValue = node.attributes[attrName].description;
  node.attributes[attrName].description = description;

  Changes.trackNodeChange(
    node.label,
    `attributes.${attrName}.description`,
    oldValue,
    description
  );
  UI.updateModifiedStatus(true);
}

function updateRelationshipDescription(relName, description) {
  if (State.currentNode === null || !State.schemaData) return;

  const node = State.schemaData.node_types[State.currentNode];
  const rel = node.relationships[relName];
  const oldValue = rel.description;
  rel.description = description;

  Changes.trackRelationshipChange(
    node.label,
    relName,
    rel.target,
    "description",
    oldValue,
    description
  );
  UI.updateModifiedStatus(true);
}

function updateRelationshipPropertyDescription(relName, propName, description) {
  if (State.currentNode === null || !State.schemaData) return;

  const node = State.schemaData.node_types[State.currentNode];
  const rel = node.relationships[relName];
  const oldValue = rel.properties[propName].description;
  rel.properties[propName].description = description;

  Changes.trackRelationshipChange(
    node.label,
    relName,
    rel.target,
    `properties.${propName}.description`,
    oldValue,
    description
  );
  UI.updateModifiedStatus(true);
}

function addRelationshipProperty(relName) {
  if (State.currentNode === null || !State.schemaData) return;

  const node = State.schemaData.node_types[State.currentNode];
  const rel = node.relationships[relName];

  const propName = prompt("Enter new relationship property name:");
  if (!propName?.trim()) {
    alert("Invalid property name.");
    return;
  }

  if (rel.properties?.[propName.trim()]) {
    alert(`Property "${propName.trim()}" already exists.`);
    return;
  }

  const propType = prompt(
    "Enter property type (e.g., string, integer, boolean, date):",
    "string"
  );
  if (!propType) return;

  if (!rel.properties) rel.properties = {};
  rel.properties[propName.trim()] = {
    type: propType.trim(),
    description: "",
  };

  Changes.trackRelationshipChange(
    node.label,
    relName,
    rel.target,
    `properties.${propName.trim()}`,
    null,
    { type: propType.trim(), description: "" }
  );

  UI.updateModifiedStatus(true);
  renderNodeDetails(node);
  openTab(null, "NodeRelations");
}

// ===== EXAMPLE LOADING FUNCTIONS =====
async function loadNodeExamples(nodeLabel) {
  const limit = document.getElementById("nodeExampleLimit").value || 10;
  const container = document.getElementById(`nodeExamples-${nodeLabel}`);

  if (!Config.neo4j.connected) {
    showConnectionWarning(container, "Load Node Examples");
    return;
  }

  container.style.display = "block";
  container.innerHTML =
    '<div class="loading-spinner"></div> Loading example nodes...';

  try {
    const examples = await Connection.executeQuery(
      `MATCH (n:${nodeLabel}) RETURN n LIMIT ${limit}`
    );
    displayNodeExamples(container, examples, nodeLabel);
  } catch (error) {
    container.innerHTML = `<div class="connection-error">❌ Error: ${error.message}</div>`;
  }
}

async function loadAttributeExamples(nodeLabel, attributeName) {
  const container = document.getElementById(
    `examples-${nodeLabel}-${attributeName}`
  );

  if (!Config.neo4j.connected) {
    showConnectionWarning(container, "Load Attribute Examples");
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div> Loading...';

  try {
    const examples = await Connection.executeQuery(
      `MATCH (n:${nodeLabel}) 
       WHERE n.${attributeName} IS NOT NULL 
       RETURN DISTINCT n.${attributeName} as value 
       LIMIT 10`
    );
    displayAttributeExamples(container, examples);
  } catch (error) {
    container.innerHTML = `<span class="example-tag" style="background: #f8d7da;">❌ Error: ${error.message}</span>`;
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

  if (!Config.neo4j.connected) {
    showConnectionWarning(container, "Load Relationship Examples");
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div> Loading...';

  try {
    const query =
      targetLabel && targetLabel !== "null"
        ? `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b:${targetLabel})
         RETURN a.name as source_name, type(r) as rel_type, b.name as target_name
         LIMIT 10`
        : `MATCH (a:${sourceLabel})-[r:${relationshipName}]->(b)
         RETURN a.name as source_name, type(r) as rel_type, labels(b)[0] as target_label
         LIMIT 10`;

    const examples = await Connection.executeQuery(query);
    displayRelationshipExamples(container, examples);
  } catch (error) {
    container.innerHTML = `<span class="example-tag" style="background: #f8d7da;">❌ Error: ${error.message}</span>`;
  }
}

// ===== DISPLAY HELPER FUNCTIONS =====
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
    container.innerHTML =
      '<span class="no-examples">No example values found</span>';
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
    container.innerHTML =
      '<span class="no-examples">No example relationships found</span>';
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

// ===== UTILITY FUNCTIONS =====
function openTab(event, tabName) {
  const tabcontent = document.getElementsByClassName("tab-content");
  for (let i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
    tabcontent[i].classList.remove("active");
  }

  const tabbuttons = document.getElementsByClassName("tab-button");
  for (let i = 0; i < tabbuttons.length; i++) {
    tabbuttons[i].classList.remove("active");
  }

  document.getElementById(tabName).style.display = "block";
  document.getElementById(tabName).classList.add("active");

  if (event?.currentTarget) {
    event.currentTarget.classList.add("active");
  } else {
    const btn = document.getElementById(`tabButton${tabName}`);
    if (btn) btn.classList.add("active");
  }
}

function filterNodes(event) {
  const searchTerm = event.target.value.toLowerCase();
  const nodes = document.querySelectorAll(".node-item");
  const detailsContainer = document.getElementById("detailsContainer");

  let firstMatchIndex = -1;

  nodes.forEach((nodeItem, index) => {
    const nodeData = State.schemaData.node_types[index];
    let match = false;

    // Search in node label
    if (nodeData.label.toLowerCase().includes(searchTerm)) {
      match = true;
    }

    // Search in attributes
    if (!match && nodeData.attributes) {
      for (const attrName in nodeData.attributes) {
        if (
          attrName.toLowerCase().includes(searchTerm) ||
          nodeData.attributes[attrName].description
            ?.toLowerCase()
            .includes(searchTerm)
        ) {
          match = true;
          break;
        }
      }
    }

    // Search in relationships
    if (!match && nodeData.relationships) {
      for (const relName in nodeData.relationships) {
        const rel = nodeData.relationships[relName];
        if (
          relName.toLowerCase().includes(searchTerm) ||
          rel.description?.toLowerCase().includes(searchTerm) ||
          rel.target?.toLowerCase().includes(searchTerm)
        ) {
          match = true;
          break;
        }
      }
    }

    nodeItem.style.display = match ? "" : "none";
    if (match && firstMatchIndex === -1) {
      firstMatchIndex = index;
    }
  });

  // Auto-select first match
  if (firstMatchIndex !== -1) {
    const currentActive = document.querySelector(".node-header.active");
    if (
      !currentActive ||
      currentActive.closest(".node-item").style.display === "none"
    ) {
      selectNode(firstMatchIndex);
    }
  } else if (searchTerm) {
    detailsContainer.innerHTML = `<div class="no-selection"><p>No matches found for "${searchTerm}"</p></div>`;
  }
}

function updateStats() {
  if (!State.schemaData?.node_types) return;
  document.getElementById(
    "nodeCount"
  ).textContent = `${State.schemaData.node_types.length} Nodes`;
}

function showConnectionWarning(container, action) {
  container.innerHTML = `
    <div class="connection-warning">
      ⚠️ No Neo4j connection. Please test connection first before attempting: ${action}.
    </div>
  `;
  if (container.style) container.style.display = "block";
}

function truncateValue(value, maxLength = 50) {
  const str = String(value);
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

// ===== EXPOSE FUNCTIONS TO GLOBAL SCOPE =====
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
window.loadNodeExamples = loadNodeExamples;
window.loadAttributeExamples = loadAttributeExamples;
window.loadRelationshipExamples = loadRelationshipExamples;
window.updateNodeDescription = updateNodeDescription;
window.updateAttributeDescription = updateAttributeDescription;
window.updateRelationshipDescription = updateRelationshipDescription;
window.updateRelationshipPropertyDescription =
  updateRelationshipPropertyDescription;
window.addRelationshipProperty = addRelationshipProperty;
window.selectNode = selectNode;
window.openTab = openTab;
window.ChangeTracker = Changes;
window.updatePropertiesToNeo4j = updatePropertiesToNeo4j;
window.updateSchemaFromDb = updateSchemaFromDb;

// Make logging controls available globally
window.CypherLogging = {
  enable: () => Logging.enableQueryLogging(),
  disable: () => Logging.disableQueryLogging(),
  toggle: () => Logging.toggleQueryLogging(),
  enableResults: () => Logging.enableResultLogging(),
  disableResults: () => Logging.disableResultLogging(),
  status: () => Logging.getLoggingStatus(),
};
