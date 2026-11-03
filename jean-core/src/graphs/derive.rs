//! Derived values: blocked, progress, serving, incoming relations, external refs.
//! Computed on every read, never written.

use std::collections::HashMap;

use super::model::{
    ExternalNodeRef, GraphNode, IncomingRelation, NodeDerived, RelationKind, ServingSession,
};

/// Another registered graph, as needed for cross-graph lookups.
pub struct OtherGraph {
    pub id: String,
    pub title: String,
    pub nodes: Vec<GraphNode>,
}

/// A session and the refs it serves.
pub struct ServingEntry {
    pub serves: Vec<String>,
    pub session: ServingSession,
}

pub struct Derived {
    pub derived: HashMap<String, NodeDerived>,
    pub incoming: HashMap<String, Vec<IncomingRelation>>,
    pub external: HashMap<String, ExternalNodeRef>,
    pub graph_serving: Vec<ServingSession>,
}

/// Session status labels that count as "working on it".
pub fn is_active_status(status: &str) -> bool {
    matches!(status, "running" | "waiting" | "review")
}

enum Target<'a> {
    Local(&'a str),
    External(&'a str, &'a str),
    Text,
}

fn resolve<'a>(target: &'a str, graph_id: &str, nodes: &[GraphNode]) -> Target<'a> {
    if nodes.iter().any(|n| n.id == target) {
        return Target::Local(target);
    }
    match target.split_once('#') {
        Some((g, n)) if g == graph_id && !n.is_empty() => Target::Local(n),
        Some((g, n)) if !g.is_empty() && !n.is_empty() => Target::External(g, n),
        _ => Target::Text,
    }
}

fn find_external<'a>(
    others: &'a [OtherGraph],
    graph_id: &str,
    node_id: &str,
) -> (Option<&'a OtherGraph>, Option<&'a GraphNode>) {
    let graph = others.iter().find(|g| g.id == graph_id);
    let node = graph.and_then(|g| g.nodes.iter().find(|n| n.id == node_id));
    (graph, node)
}

fn external_ref(others: &[OtherGraph], graph_id: &str, node_id: &str) -> ExternalNodeRef {
    let (graph, node) = find_external(others, graph_id, node_id);
    ExternalNodeRef {
        reference: format!("{graph_id}#{node_id}"),
        graph_id: graph_id.to_string(),
        graph_title: graph.map(|g| g.title.clone()),
        node_id: node_id.to_string(),
        title: node.map(|n| n.title.clone()),
        state: node.map(|n| n.state),
        found: node.is_some(),
    }
}

pub fn derive(
    graph_id: &str,
    nodes: &[GraphNode],
    others: &[OtherGraph],
    serving: &[ServingEntry],
) -> Derived {
    let mut derived: HashMap<String, NodeDerived> = nodes
        .iter()
        .map(|n| (n.id.clone(), NodeDerived::default()))
        .collect();
    let mut incoming: HashMap<String, Vec<IncomingRelation>> = HashMap::new();
    let mut external: HashMap<String, ExternalNodeRef> = HashMap::new();

    // Outgoing relations of this graph: blockers, progress, incoming, external.
    for node in nodes {
        for rel in &node.relations {
            match resolve(&rel.target, graph_id, nodes) {
                Target::Local(target_id) => {
                    let target = nodes.iter().find(|n| n.id == target_id);
                    if let Some(target) = target {
                        if matches!(rel.kind, RelationKind::DependsOn | RelationKind::BlockedBy)
                            && !target.state.is_closed()
                        {
                            push_blocker(&mut derived, node, rel.kind, &target.title);
                        }
                        if rel.kind == RelationKind::PartOf {
                            count_child(&mut derived, target_id, node);
                        }
                        incoming
                            .entry(target_id.to_string())
                            .or_default()
                            .push(IncomingRelation {
                                kind: rel.kind,
                                source: node.id.clone(),
                                external: false,
                            });
                    } else if rel.kind == RelationKind::BlockedBy {
                        push_blocker(&mut derived, node, rel.kind, &rel.target);
                    }
                }
                Target::External(g, n) => {
                    let ext = external_ref(others, g, n);
                    if matches!(rel.kind, RelationKind::DependsOn | RelationKind::BlockedBy) {
                        match (&ext.title, ext.state) {
                            (Some(title), Some(state)) if !state.is_closed() => {
                                push_blocker(&mut derived, node, rel.kind, title)
                            }
                            (None, _) if rel.kind == RelationKind::BlockedBy => {
                                push_blocker(&mut derived, node, rel.kind, &rel.target)
                            }
                            _ => {}
                        }
                    }
                    external.insert(ext.reference.clone(), ext);
                }
                Target::Text => {
                    if rel.kind == RelationKind::BlockedBy {
                        push_blocker(&mut derived, node, rel.kind, &rel.target);
                    }
                }
            }
        }
    }

    // Relations from other registered graphs into this one.
    for other in others.iter().filter(|g| g.id != graph_id) {
        for source in &other.nodes {
            for rel in &source.relations {
                let Some((g, target_id)) = rel.target.split_once('#') else {
                    continue;
                };
                if g != graph_id || !derived.contains_key(target_id) {
                    continue;
                }
                if rel.kind == RelationKind::PartOf {
                    count_child(&mut derived, target_id, source);
                }
                let ext = external_ref(others, &other.id, &source.id);
                incoming
                    .entry(target_id.to_string())
                    .or_default()
                    .push(IncomingRelation {
                        kind: rel.kind,
                        source: ext.reference.clone(),
                        external: true,
                    });
                external.insert(ext.reference.clone(), ext);
            }
        }
    }

    // Serving sessions.
    let mut graph_serving = Vec::new();
    for entry in serving {
        for r in &entry.serves {
            if r == graph_id {
                graph_serving.push(entry.session.clone());
            } else if let Some(d) = r
                .split_once('#')
                .filter(|(g, _)| *g == graph_id)
                .and_then(|(_, n)| derived.get_mut(n))
            {
                d.active |= is_active_status(&entry.session.status);
                d.serving.push(entry.session.clone());
            }
        }
    }

    for (id, d) in derived.iter_mut() {
        let open = nodes
            .iter()
            .find(|n| &n.id == id)
            .is_some_and(|n| !n.state.is_closed());
        if !open {
            d.blockers.clear();
        }
        d.blocked = !d.blockers.is_empty();
    }

    Derived {
        derived,
        incoming,
        external,
        graph_serving,
    }
}

fn push_blocker(
    derived: &mut HashMap<String, NodeDerived>,
    node: &GraphNode,
    kind: RelationKind,
    what: &str,
) {
    if let Some(d) = derived.get_mut(&node.id) {
        d.blockers.push(format!("{} {what}", kind.as_str()));
    }
}

fn count_child(derived: &mut HashMap<String, NodeDerived>, parent_id: &str, child: &GraphNode) {
    if let Some(d) = derived.get_mut(parent_id) {
        if child.state != super::model::NodeState::Dropped {
            d.progress_total += 1;
            if child.state == super::model::NodeState::Done {
                d.progress_done += 1;
            }
        }
    }
}
