# Quick Start Guide - Neo4j Schema Editor mit MCP

## 🚀 Schnellstart (5 Minuten)

### Schritt 1: MCP Server starten
```bash
# Einfach das Batch-Script ausführen
start_mcp_server.bat
```

### Schritt 2: Schema Editor öffnen
```bash
# HTML-Datei im Browser öffnen
schema_editor_interface.html
```

### Schritt 3: MCP Verbindung testen
1. Im Schema Editor auf "🤖 AI Description Generator (MCP)" klicken
2. MCP Server URL: `http://localhost:3000`
3. "Test MCP Connection" klicken

### Schritt 4: Neo4j Datenbank verbinden (optional)
1. "🔗 Neo4j Connection" erweitern
2. Ihre Verbindungsdaten eingeben:
   - URI: `bolt://srv-mig-test.migraven.com:7687`
   - Username: `migRavenDBAdministr++`
   - Password: `[Ihr Passwort]`
   - Database: `graph.db`
3. "Test Connection" klicken

### Schritt 5: Schema bearbeiten
1. JSON-Schema laden oder aus Datenbank generieren
2. Node auswählen und bearbeiten
3. ⚡-Buttons für AI-Beschreibungen nutzen

## 🔧 Troubleshooting

### MCP Server startet nicht?
- Prüfen Sie ob `uvx` installiert ist: `uvx --version`
- Falls nicht: `pip install uv`

### Keine AI-Buttons sichtbar?
- MCP Verbindung testen
- Browser-Konsole auf Fehler prüfen

### Neo4j Verbindung fehlschlägt?
- Firewall/Netzwerk prüfen
- Credentials überprüfen
- Database-Name validieren

## 📚 Weiterführende Dokumentation
- `README.md` - Vollständige Dokumentation
- `mcp_server_setup.md` - Detaillierte MCP Setup-Anleitung
