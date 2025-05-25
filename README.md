# migRaven Schema Editor with MCP Integration

A powerful web-based Neo4j schema editor with AI-powered description generation using Model Context Protocol (MCP).

## Features

### Core Schema Editor
- **Interactive Schema Management**: Load, edit, and save Neo4j database schemas
- **Visual Tree View**: Navigate through node types, attributes, and relationships
- **Real-time Editing**: Modify descriptions, add properties, and update relationships
- **Database Integration**: Connect to Neo4j databases for live schema operations
- **Import/Export**: Support for JSON schema files and Cypher script generation

### AI-Powered Description Generation (MCP Integration)
- **Smart Context Awareness**: Uses Neo4j MCP server to provide database context
- **Intelligent Descriptions**: Generate descriptions for nodes, relationships, and properties
- **Real-time AI Assistance**: AI generate buttons appear next to description fields
- **Database Schema Context**: Leverages actual database structure for accurate descriptions
- Das Schema wird geparst und die verschiedenen Knotentypen (`node_types`) werden in einer Baumansicht auf der linken Seite dargestellt.
- Für jeden Knotentyp werden die Anzahl der Attribute und Beziehungen angezeigt.
- Eine Suchfunktion ermöglicht das Filtern der Knotentypen.

### Bearbeiten von Schema-Details
- Durch Klicken auf einen Knotentyp in der Baumansicht werden dessen Details auf der rechten Seite angezeigt.
- Folgende Informationen können eingesehen und bearbeitet werden:
    - **Knoten-Label:** (Schreibgeschützt) Der Name des Knotentyps.
    - **Knoten-Beschreibung:** Eine textuelle Beschreibung des Knotentyps.
    - **Attribute:**
        - Name des Attributs.
        - Typ des Attributs (z.B. String, Integer).
        - Ob das Attribut indiziert ist.
        - Ob das Attribut eindeutig (unique) sein muss.
        - Eine textuelle Beschreibung des Attributs.
    - **Beziehungen (Relationships):**
        - Name der Beziehung.
        - Ziel-Knotentyp der Beziehung.
        - Eine textuelle Beschreibung der Beziehung.

### Interaktion mit Neo4j (Simuliert)
- Die Oberfläche bietet Felder zur Eingabe von Neo4j-Verbindungsdaten (URL, Benutzer, Passwort).
- Eine "Verbindung testen"-Funktion simuliert einen Verbindungstest.
- **Wichtiger Hinweis:** Die aktuelle Version verwendet **simulierte Daten** für Neo4j-Abfragen. Für eine echte Interaktion mit einer Neo4j-Datenbank muss der JavaScript-Code (`testConnection`, `executeNeo4jQuery`) angepasst und die offizielle Neo4j-JavaScript-Driver-Bibliothek eingebunden werden.
- **Beispielwerte laden:**
    - Für ausgewählte Knoten können Beispiel-Knoten aus der (simulierten) Neo4j-Datenbank geladen und angezeigt werden.
    - Für Attribute können Beispielwerte geladen werden.
    - Für Beziehungen können Beispiel-Beziehungen geladen werden.

### Speichern und Exportieren
- **Schema speichern:** Die aktuellen Schema-Daten (inklusive aller Änderungen) können als JSON-Datei heruntergeladen werden. Der Dateiname enthält das aktuelle Datum.
- **Cypher Export:** Das aktuelle Schema kann als Cypher-Skript exportiert werden. Dieses Skript enthält:
    - Einen `UNWIND`-Befehl, um die Schema-Definitionen in die `migRaven_Schema`-Knoten in Neo4j zu importieren/aktualisieren.
    - Beispiel-MATCH-Abfragen für jeden Knotentyp, dessen Attribute und Beziehungen.
    - Einen Kommentar, der die JSON-Daten als Parameter für die Neo4j-Shell enthält.

## Zukünftige Verwendung mit Neo4j

Das Ziel dieser Anwendung ist es, die Bearbeitung von migRaven-Schemata zu vereinfachen, die dann direkt in einer Neo4j-Datenbank verwendet werden können.

1.  **Schema-Definition:** Definieren und verfeinern Sie Ihre Knotentypen, deren Attribute und Beziehungen über die Weboberfläche.
2.  **Export als Cypher:** Exportieren Sie das Schema als Cypher-Skript.
3.  **Import in Neo4j:**
    *   Öffnen Sie die Neo4j-Browser-Oberfläche oder Cypher-Shell.
    *   Kopieren Sie den generierten Cypher-Code.
    *   Führen Sie den Teil des Skripts aus, der mit `UNWIND $schema_json.node_types...` beginnt. Stellen Sie sicher, dass Sie den JSON-Teil als Parameter `:param schema_json => { ... }` an die Abfrage übergeben, wie im Skript am Ende kommentiert.
    *   Alternativ können Sie die JSON-Daten direkt in die Abfrage einbetten, falls Ihre Neo4j-Umgebung dies unterstützt oder Sie den Neo4j-Treiber in einer Anwendung verwenden.

Nach dem Import sind die Schema-Informationen in Ihrer Neo4j-Datenbank als `migRaven_Schema`-Knoten verfügbar und können für Validierungen, Abfragen oder zur Dokumentation Ihrer Datenstruktur genutzt werden. Die Beispielabfragen im Cypher-Export dienen als Ausgangspunkt für die Exploration Ihrer Daten basierend auf dem definierten Schema.

## Technische Details

-   **Frontend:** HTML, CSS, Vanilla JavaScript.
-   **Datenformat:** JSON für Schema-Definitionen.
-   **Datenbank-Interaktion (Ziel):** Neo4j über Cypher-Abfragen.

## Einrichtung für echte Neo4j-Verbindung

Um die Anwendung mit einer echten Neo4j-Datenbank zu verbinden:

1.  **Neo4j JavaScript Driver einbinden:**
    Fügen Sie die Neo4j-Driver-Bibliothek zu Ihrem HTML hinzu, z.B. über ein CDN:
    ```html
    <script src="https://unpkg.com/neo4j-driver"></script>
    ```
2.  **JavaScript-Funktionen anpassen:**
    -   Modifizieren Sie die `testConnection`-Funktion, um eine echte Verbindung mit `neo4j.driver(...).verifyConnectivity()` herzustellen.
    -   Modifizieren Sie die `executeNeo4jQuery`-Funktion, um eine Session zu öffnen, die übergebene Cypher-Query auszuführen und die Ergebnisse zu verarbeiten.
    -   Stellen Sie sicher, dass Fehlerbehandlung und Ressourcenmanagement (Schließen von Sessions/Driver) korrekt implementiert sind.

## Dateistruktur

```
migRaven_Schema_Editor/
├── schema_editor_interface.html    # Main HTML interface
├── schema_editor_scripts.js        # Core editor functionality
├── mcp_integration.js              # MCP server integration
├── migraven_schema_export.json     # Sample schema file
└── README.md                       # This file
```

## Setup Instructions

### 1. Basic Setup
1. Open `schema_editor_interface.html` in a modern web browser
2. Load a schema JSON file or connect to a Neo4j database
3. Start editing your schema using the visual interface

### 2. Neo4j Database Connection
1. Click "🔗 Neo4j Connection" to expand configuration
2. Enter your Neo4j connection details:
   - **URI**: Your Neo4j database URI (e.g., `bolt://localhost:7687`)
   - **Username**: Database username
   - **Password**: Database password
   - **Database**: Target database name (optional)
3. Click "Test Connection" to verify connectivity
4. Use "Generate Schema from DB" to create schema from existing database
5. Use "Load from DB" / "Save to DB" for schema persistence

### 3. MCP Server Integration (AI Features)
1. Set up the Neo4j MCP server following the [official guide](https://github.com/neo4j-contrib/mcp-neo4j/tree/main/servers/mcp-neo4j-cypher)
2. Start your MCP server (typically on `http://localhost:3000`)
3. In the Schema Editor, click "🤖 AI Description Generator (MCP)"
4. Enter your MCP server URL and click "Test MCP Connection"
5. Once connected, AI generate buttons (⚡) will appear next to description fields

## MCP Server Setup

To enable AI-powered description generation, you need to run the Neo4j MCP server:

### Prerequisites
- Node.js and npm installed
- Neo4j database running and accessible

### Installation
```bash
# Clone the MCP Neo4j repository
git clone https://github.com/neo4j-contrib/mcp-neo4j.git
cd mcp-neo4j/servers/mcp-neo4j-cypher

# Install dependencies
npm install

# Configure your Neo4j connection
# Edit configuration file with your Neo4j details

# Start the MCP server
npm start
```

The MCP server will typically run on `http://localhost:3000`.

## 🛠️ MCP Server Scripts und Tools

Das Projekt enthält verschiedene Scripts zum einfachen Starten und Verwalten des MCP Servers:

### Verfügbare Scripts

#### 1. `setup.bat` - Einmalige Einrichtung
```bash
setup.bat
```
- Überprüft und installiert alle Abhängigkeiten
- Installiert `uvx` falls nicht vorhanden
- Muss nur einmal ausgeführt werden

#### 2. `start_mcp_server.bat` - Einfacher Start (Windows)
```bash
start_mcp_server.bat
```
- Startet den MCP Server mit Ihrer Konfiguration
- Setzt automatisch alle Umgebungsvariablen
- Einfachste Methode für den täglichen Gebrauch

#### 3. `start_mcp_server.ps1` - PowerShell Version
```powershell
.\start_mcp_server.ps1
```
- PowerShell-Version mit besserer Fehlerbehandlung
- Farbige Ausgabe und detaillierte Statusinformationen

#### 4. `start_mcp_server.py` - Plattformübergreifend
```bash
python start_mcp_server.py
```
- Funktioniert auf Windows, Linux und macOS
- Einfache Python-Version ohne Abhängigkeiten

#### 5. `start_mcp_server_advanced.py` - Erweiterte Features
```bash
# Produktionsumgebung (Standard)
python start_mcp_server_advanced.py --env production

# Entwicklungsumgebung
python start_mcp_server_advanced.py --env development

# Mit Verbindungstest
python start_mcp_server_advanced.py --env production --test-connection
```

#### 6. `test_system.py` - Systemtest
```bash
python test_system.py
```
- Testet alle Komponenten des Systems
- Überprüft Abhängigkeiten, Dateien und Verbindungen
- Generiert detaillierten Testbericht

### Konfigurationsdateien

#### `mcp_server_config.json` - MCP Konfiguration
Ihre aktuelle MCP Server Konfiguration für externe Tools.

#### `mcp_environments.config` - Umgebungskonfiguration
Enthält Konfigurationen für verschiedene Umgebungen:
- `production` - Ihr aktueller Server
- `development` - Lokale Entwicklung
- `testing` - Test-Umgebung
- `docker` - Docker-Container

### Schnellstart-Anleitung

1. **Einmalige Einrichtung:**
   ```bash
   setup.bat
   ```

2. **System testen:**
   ```bash
   python test_system.py
   ```

3. **MCP Server starten:**
   ```bash
   start_mcp_server.bat
   ```

4. **Schema Editor öffnen:**
   - `schema_editor_interface.html` im Browser öffnen
   - MCP Verbindung testen (http://localhost:3000)

### Fehlerbehebung

#### MCP Server startet nicht
- Führen Sie `setup.bat` aus
- Überprüfen Sie `python test_system.py`
- Prüfen Sie ob Port 3000 frei ist

#### Keine Verbindung zum Neo4j Server
- Überprüfen Sie Netzwerkverbindung
- Validieren Sie Credentials in den Scripts
- Testen Sie mit `--test-connection` Parameter

#### AI-Buttons funktionieren nicht
- Stellen Sie sicher, dass MCP Server läuft
- Testen Sie Verbindung im Schema Editor
- Überprüfen Sie Browser-Konsole auf Fehler

## Usage Guide

### Loading a Schema
1. **From File**: Click "📁 Load Schema" and select a JSON schema file
2. **From Database**: Connect to Neo4j and click "📥 Load from DB"
3. **Generate New**: Connect to Neo4j and click "🔄 Generate Schema from DB"

### Editing Schema Elements
1. **Select Node**: Click on any node in the tree view
2. **Edit Properties**: Use the tabbed interface to edit:
   - Node description and attributes
   - Relationship definitions and properties
   - View database examples (when connected)

### AI Description Generation
1. **Connect MCP Server**: Ensure MCP integration is active
2. **Generate Descriptions**: Click ⚡ buttons next to description fields
3. **Context-Aware**: AI uses your database schema context for intelligent suggestions

### Saving and Exporting
1. **Save to File**: Click "💾 Download Schema" for JSON export
2. **Save to Database**: Click "💾 Save to DB" to persist in Neo4j
3. **Generate Cypher**: Click "📜 Export Cypher" for database creation scripts
4. **Compare Versions**: Use "🔍 Compare with DB" to check differences

## API Integration

### MCP Integration Functions
The `mcp_integration.js` module provides:

```javascript
// Test MCP server connectivity
testMcpConnection()

// Generate AI descriptions
generateNodeDescription(nodeLabel)
generateRelationshipDescription(sourceLabel, relationshipType, targetLabel)  
generatePropertyDescription(nodeLabel, propertyName, propertyType)

// UI helper functions
addAiGenerateButton(textarea, generateFunction)
updateAiButtonStates(enabled)
```

### Neo4j Integration
The main script provides full Neo4j integration:

```javascript
// Database operations
loadSchemaFromNeo4j()
saveSchemaToNeo4j()
generateSchemaFromDb()
compareWithDbSchema()

// Query execution
executeNeo4jQuery(query, params)
testConnection()
```

## Configuration

### Schema JSON Format
```json
{
  "node_types": [
    {
      "label": "Person",
      "description": "Represents a person in the system",
      "attributes": {
        "name": {
          "type": "string",
          "description": "Full name of the person"
        },
        "age": {
          "type": "integer", 
          "description": "Age in years"
        }
      },
      "relationships": {
        "KNOWS": {
          "target": "Person",
          "description": "Relationship between people who know each other",
          "properties": {
            "since": {
              "type": "date",
              "description": "Date when the relationship started"
            }
          }
        }
      }
    }
  ],
  "version": 1,
  "timestamp": "2025-05-24T10:00:00.000Z",
  "source": "Schema Editor"
}
```

## Troubleshooting

### Common Issues

1. **MCP Connection Failed**
   - Ensure MCP server is running
   - Check URL format (include http:// or https://)
   - Verify server is accessible from browser

2. **Neo4j Connection Issues**
   - Verify database is running
   - Check URI format (bolt://, neo4j://, etc.)
   - Confirm credentials are correct
   - Ensure database name exists (if specified)

3. **AI Generation Not Working**
   - Test MCP connection first
   - Check browser console for errors
   - Ensure MCP server has database access
   - Verify MCP server configuration

### Browser Requirements
- Modern browser with ES6+ support
- JavaScript enabled
- Local file access (for JSON loading)
- CORS support for MCP server communication

## Development

### Extending Functionality
The modular design allows for easy extension:

1. **New AI Features**: Add functions to `mcp_integration.js`
2. **Database Operations**: Extend `schema_editor_scripts.js`
3. **UI Components**: Modify `schema_editor_interface.html`

### Dependencies
- Neo4j JavaScript Driver (loaded via CDN)
- Modern browser APIs (Fetch, ES6+)
- Neo4j MCP Server (for AI features)

## Contributing

Feel free to contribute improvements:
1. Enhanced AI prompts for better description generation
2. Additional export formats (GraphQL, OpenAPI, etc.)
3. Advanced schema validation
4. Improved visual design
5. Additional database integrations

## License

This project is part of the migRaven ecosystem for Neo4j schema management and migration.
