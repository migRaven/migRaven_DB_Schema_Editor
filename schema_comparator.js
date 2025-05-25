/**
 * Schema Comparison Tool for migRaven Schema Editor
 * 
 * This module provides comprehensive schema comparison functionality
 * to help identify differences between schema versions.
 */

class SchemaComparator {
    constructor() {
        this.comparisonResults = null;
    }

    /**
     * Compare two schemas and identify differences
     */
    compare(schema1, schema2, labels = { schema1: 'Schema A', schema2: 'Schema B' }) {
        const results = {
            summary: {
                identical: true,
                totalDifferences: 0,
                nodeChanges: 0,
                attributeChanges: 0,
                relationshipChanges: 0
            },
            differences: [],
            metadata: {
                schema1: {
                    name: labels.schema1,
                    version: schema1?.version || 'Unknown',
                    timestamp: schema1?.timestamp || 'Unknown',
                    nodeCount: schema1?.node_types?.length || 0
                },
                schema2: {
                    name: labels.schema2,
                    version: schema2?.version || 'Unknown', 
                    timestamp: schema2?.timestamp || 'Unknown',
                    nodeCount: schema2?.node_types?.length || 0
                }
            }
        };

        if (!schema1?.node_types || !schema2?.node_types) {
            results.differences.push({
                type: 'error',
                category: 'structure',
                message: 'Invalid schema structure - missing node_types'
            });
            return results;
        }

        // Compare node types
        this.compareNodeTypes(schema1.node_types, schema2.node_types, results);
        
        // Update summary
        results.summary.identical = results.differences.length === 0;
        results.summary.totalDifferences = results.differences.length;
        results.summary.nodeChanges = results.differences.filter(d => d.category === 'node').length;
        results.summary.attributeChanges = results.differences.filter(d => d.category === 'attribute').length;
        results.summary.relationshipChanges = results.differences.filter(d => d.category === 'relationship').length;

        this.comparisonResults = results;
        return results;
    }

    compareNodeTypes(nodeTypes1, nodeTypes2, results) {
        const nodeMap1 = new Map(nodeTypes1.map(n => [n.label, n]));
        const nodeMap2 = new Map(nodeTypes2.map(n => [n.label, n]));

        // Find added nodes
        for (const [label, node] of nodeMap2) {
            if (!nodeMap1.has(label)) {
                results.differences.push({
                    type: 'addition',
                    category: 'node',
                    message: `Node type '${label}' was added`,
                    details: { nodeLabel: label, node: node }
                });
            }
        }

        // Find removed nodes and compare existing ones
        for (const [label, node1] of nodeMap1) {
            if (!nodeMap2.has(label)) {
                results.differences.push({
                    type: 'removal',
                    category: 'node',
                    message: `Node type '${label}' was removed`,
                    details: { nodeLabel: label, node: node1 }
                });
            } else {
                // Compare existing nodes
                this.compareNodeDetails(node1, nodeMap2.get(label), results);
            }
        }
    }

    compareNodeDetails(node1, node2, results) {
        const label = node1.label;

        // Compare descriptions
        if (node1.description !== node2.description) {
            results.differences.push({
                type: 'modification',
                category: 'node',
                message: `Node '${label}' description changed`,
                details: {
                    nodeLabel: label,
                    field: 'description',
                    oldValue: node1.description || '',
                    newValue: node2.description || ''
                }
            });
        }

        // Compare attributes
        this.compareAttributes(node1.attributes || [], node2.attributes || [], label, results);

        // Compare relationships
        this.compareRelationships(node1.relationships || [], node2.relationships || [], label, results);
    }

    compareAttributes(attrs1, attrs2, nodeLabel, results) {
        const attrMap1 = new Map(attrs1.map(a => [a.name, a]));
        const attrMap2 = new Map(attrs2.map(a => [a.name, a]));

        // Find added attributes
        for (const [name, attr] of attrMap2) {
            if (!attrMap1.has(name)) {
                results.differences.push({
                    type: 'addition',
                    category: 'attribute',
                    message: `Attribute '${name}' was added to node '${nodeLabel}'`,
                    details: { nodeLabel, attributeName: name, attribute: attr }
                });
            }
        }

        // Find removed attributes and compare existing ones
        for (const [name, attr1] of attrMap1) {
            if (!attrMap2.has(name)) {
                results.differences.push({
                    type: 'removal',
                    category: 'attribute',
                    message: `Attribute '${name}' was removed from node '${nodeLabel}'`,
                    details: { nodeLabel, attributeName: name, attribute: attr1 }
                });
            } else {
                // Compare existing attributes
                this.compareAttributeDetails(attr1, attrMap2.get(name), nodeLabel, results);
            }
        }
    }

    compareAttributeDetails(attr1, attr2, nodeLabel, results) {
        const name = attr1.name;
        const fields = ['type', 'indexed', 'unique', 'description'];

        fields.forEach(field => {
            if (attr1[field] !== attr2[field]) {
                results.differences.push({
                    type: 'modification',
                    category: 'attribute',
                    message: `Attribute '${name}' in node '${nodeLabel}': ${field} changed`,
                    details: {
                        nodeLabel,
                        attributeName: name,
                        field,
                        oldValue: attr1[field],
                        newValue: attr2[field]
                    }
                });
            }
        });
    }

    compareRelationships(rels1, rels2, nodeLabel, results) {
        const relMap1 = new Map(rels1.map(r => [`${r.name}-${r.target_node}`, r]));
        const relMap2 = new Map(rels2.map(r => [`${r.name}-${r.target_node}`, r]));

        // Find added relationships
        for (const [key, rel] of relMap2) {
            if (!relMap1.has(key)) {
                results.differences.push({
                    type: 'addition',
                    category: 'relationship',
                    message: `Relationship '${rel.name}' to '${rel.target_node}' was added to node '${nodeLabel}'`,
                    details: { nodeLabel, relationshipKey: key, relationship: rel }
                });
            }
        }

        // Find removed relationships and compare existing ones
        for (const [key, rel1] of relMap1) {
            if (!relMap2.has(key)) {
                results.differences.push({
                    type: 'removal',
                    category: 'relationship',
                    message: `Relationship '${rel1.name}' to '${rel1.target_node}' was removed from node '${nodeLabel}'`,
                    details: { nodeLabel, relationshipKey: key, relationship: rel1 }
                });
            } else {
                // Compare existing relationships
                this.compareRelationshipDetails(rel1, relMap2.get(key), nodeLabel, results);
            }
        }
    }

    compareRelationshipDetails(rel1, rel2, nodeLabel, results) {
        const name = rel1.name;
        const target = rel1.target_node;

        if (rel1.description !== rel2.description) {
            results.differences.push({
                type: 'modification',
                category: 'relationship',
                message: `Relationship '${name}' to '${target}' in node '${nodeLabel}': description changed`,
                details: {
                    nodeLabel,
                    relationshipName: name,
                    targetNode: target,
                    field: 'description',
                    oldValue: rel1.description || '',
                    newValue: rel2.description || ''
                }
            });
        }
    }

    /**
     * Generate HTML report of comparison results
     */
    generateHtmlReport(results = this.comparisonResults) {
        if (!results) {
            return '<p>No comparison results available.</p>';
        }

        let html = `
            <div class="comparison-report">
                <div class="comparison-summary">
                    <h4>📊 Comparison Summary</h4>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <strong>Status:</strong> 
                            ${results.summary.identical ? 
                                '<span style="color: #28a745;">✅ Identical</span>' : 
                                '<span style="color: #dc3545;">❌ Differences Found</span>'
                            }
                        </div>
                        <div class="summary-item">
                            <strong>Total Differences:</strong> ${results.summary.totalDifferences}
                        </div>
                        <div class="summary-item">
                            <strong>Node Changes:</strong> ${results.summary.nodeChanges}
                        </div>
                        <div class="summary-item">
                            <strong>Attribute Changes:</strong> ${results.summary.attributeChanges}
                        </div>
                        <div class="summary-item">
                            <strong>Relationship Changes:</strong> ${results.summary.relationshipChanges}
                        </div>
                    </div>
                </div>
        `;

        if (results.differences.length > 0) {
            html += `
                <div class="comparison-details">
                    <h4>🔍 Detailed Changes</h4>
                    <div class="differences-list">
            `;

            results.differences.forEach((diff, index) => {
                const typeColors = {
                    addition: '#28a745',
                    removal: '#dc3545',
                    modification: '#ffc107',
                    error: '#dc3545'
                };

                const typeIcons = {
                    addition: '➕',
                    removal: '➖',
                    modification: '🔄',
                    error: '❌'
                };

                html += `
                    <div class="difference-item" style="border-left: 4px solid ${typeColors[diff.type]};">
                        <div class="diff-header">
                            <span class="diff-icon">${typeIcons[diff.type]}</span>
                            <span class="diff-type">${diff.type.toUpperCase()}</span>
                            <span class="diff-category">[${diff.category}]</span>
                        </div>
                        <div class="diff-message">${diff.message}</div>
                        ${this.generateDiffDetails(diff)}
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    generateDiffDetails(diff) {
        if (!diff.details) return '';

        let details = '<div class="diff-details">';

        if (diff.details.oldValue !== undefined && diff.details.newValue !== undefined) {
            details += `
                <div class="value-comparison">
                    <div class="old-value">
                        <strong>Old:</strong> <code>${this.escapeHtml(diff.details.oldValue)}</code>
                    </div>
                    <div class="new-value">
                        <strong>New:</strong> <code>${this.escapeHtml(diff.details.newValue)}</code>
                    </div>
                </div>
            `;
        }

        details += '</div>';
        return details;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in main application
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SchemaComparator;
} else {
    window.SchemaComparator = SchemaComparator;
}
