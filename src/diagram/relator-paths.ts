/**
 * Copied from tonto-visualizer's packages/extension/src/diagram-panel.ts,
 * where it is private to the extension's host. Arrange gives a relator a rank
 * between the classes it mediates; without this, the playground arranges the
 * same model differently from the extension. Keep it the same as the source,
 * and drop it for an import if the visualizer ever exports it.
 */

import type { ViewModel, ViewRelation } from 'tonto-view';

/**
 * A relator reifies the material relation between its mediated classes. Make
 * that path part of the graph ELK arranges: an edge into the relator followed
 * by an edge out gives it an intermediate rank and makes neighbouring nodes
 * leave room for it.
 */
export function prioritizeRelatorPaths(view: ViewModel, materials: readonly ViewRelation[]): ViewModel {
    const relators = new Set(view.nodes
        .filter(node => node.stereotype === 'relator').map(node => node.id));
    const materialFor = new Map<string, ViewRelation>();
    for (const material of materials) {
        for (const id of material.derivedFrom ?? []) {
            if (relators.has(id) && !materialFor.has(id)) {
                materialFor.set(id, material);
            }
        }
    }

    const mediationEdges = view.edges.filter((edge): edge is ViewRelation =>
        edge.kind === 'relation' && edge.stereotype === 'mediation');
    const mediationsFor = new Map<string, ViewRelation[]>();
    for (const edge of mediationEdges) {
        const relator = relators.has(edge.source) ? edge.source
            : relators.has(edge.target) ? edge.target : undefined;
        if (relator) {
            const edges = mediationsFor.get(relator) ?? [];
            edges.push(edge);
            mediationsFor.set(relator, edges);
        }
    }
    const directions = new Map<string, Pick<ViewRelation, 'source' | 'target'>>();
    for (const relator of relators) {
        const mediations = mediationsFor.get(relator) ?? [];
        const classAt = (edge: ViewRelation) => edge.source === relator ? edge.target : edge.source;
        const material = materialFor.get(relator);
        const sourceMediation = material
            ? mediations.find(edge => classAt(edge) === material.source)
            : mediations[0];
        const targetMediation = material
            ? mediations.find(edge => classAt(edge) === material.target)
            : mediations.find(edge => edge.id !== sourceMediation?.id);
        if (!sourceMediation || !targetMediation || sourceMediation.id === targetMediation.id) {
            continue;
        }
        const sourceClass = classAt(sourceMediation);
        const targetClass = classAt(targetMediation);
        // Use a derived material relation's reading when it names this
        // relator. Otherwise, the declaration order of its two mediations is
        // the stable direction. In both cases the layout path runs through
        // the relator, while the displayed edges keep their model direction.
        directions.set(sourceMediation.id, { source: sourceClass, target: relator });
        directions.set(targetMediation.id, { source: relator, target: targetClass });
    }

    if (directions.size === 0) {
        return view;
    }
    const edges = view.edges.map(edge => {
        const direction = directions.get(edge.id);
        return direction ? { ...edge, ...direction } : edge;
    });
    return { ...view, edges };
}
