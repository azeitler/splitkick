//! Graph file types (YAML) and API types (camelCase JSON).
//!
//! File types keep unknown fields in `extra` maps so a write never drops what
//! another tool or a human added. `serde_yaml::Mapping` keeps insertion order.

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

// ============================================================================
// Enums
// ============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum NodeState {
    #[default]
    Proposed,
    Committed,
    Done,
    Dropped,
}

impl NodeState {
    /// Done and dropped nodes no longer block anything.
    pub fn is_closed(self) -> bool {
        matches!(self, NodeState::Done | NodeState::Dropped)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            NodeState::Proposed => "proposed",
            NodeState::Committed => "committed",
            NodeState::Done => "done",
            NodeState::Dropped => "dropped",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RelationKind {
    DependsOn,
    BlockedBy,
    PartOf,
    RelatesTo,
}

impl RelationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RelationKind::DependsOn => "depends-on",
            RelationKind::BlockedBy => "blocked-by",
            RelationKind::PartOf => "part-of",
            RelationKind::RelatesTo => "relates-to",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "depends-on" => Some(RelationKind::DependsOn),
            "blocked-by" => Some(RelationKind::BlockedBy),
            "part-of" => Some(RelationKind::PartOf),
            "relates-to" => Some(RelationKind::RelatesTo),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum GraphPermission {
    Read,
    Write,
    Manage,
}

impl GraphPermission {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "read" => Some(GraphPermission::Read),
            "write" => Some(GraphPermission::Write),
            "manage" => Some(GraphPermission::Manage),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            GraphPermission::Read => "read",
            GraphPermission::Write => "write",
            GraphPermission::Manage => "manage",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GraphLocationKind {
    ProjectRepo,
    OtherRepo,
    Folder,
}

// ============================================================================
// File types
// ============================================================================

/// One graph YAML file.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct GraphFile {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, rename = "type", skip_serializing_if = "String::is_empty")]
    pub graph_type: String,
    #[serde(default)]
    pub nodes: Vec<NodeFile>,
    #[serde(flatten)]
    pub extra: Mapping,
}

/// One node as written in the file.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct NodeFile {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// `None` = not written (reads as `proposed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<NodeState>,
    #[serde(default, skip_serializing_if = "Mapping::is_empty")]
    pub properties: Mapping,
    /// One-key maps: `- depends-on: x91ffa`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<Mapping>,
    /// One-key maps: `- issue: owner/repo#1`; unknown kinds are kept.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Mapping>,
    #[serde(flatten)]
    pub extra: Mapping,
}

/// A YAML scalar as a string (numbers and bools as written).
fn scalar_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => serde_yaml::to_string(other)
            .map(|s| s.trim_end().to_string())
            .unwrap_or_default(),
    }
}

/// The single key/value of a one-key map.
fn one_key(map: &Mapping) -> Option<(String, String)> {
    let (k, v) = map.iter().next()?;
    Some((scalar_string(k), scalar_string(v)))
}

fn one_key_map(key: &str, value: &str) -> Mapping {
    let mut m = Mapping::new();
    m.insert(
        Value::String(key.to_string()),
        Value::String(value.to_string()),
    );
    m
}

impl NodeFile {
    pub fn state(&self) -> NodeState {
        self.state.unwrap_or_default()
    }

    pub fn to_api(&self) -> GraphNode {
        GraphNode {
            id: self.id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            state: self.state(),
            properties: self
                .properties
                .iter()
                .map(|(k, v)| (scalar_string(k), scalar_string(v)))
                .collect(),
            relations: self
                .relations
                .iter()
                .filter_map(one_key)
                .filter_map(|(k, target)| {
                    RelationKind::parse(&k).map(|kind| GraphRelation { kind, target })
                })
                .collect(),
            attachments: self
                .attachments
                .iter()
                .filter_map(one_key)
                .map(|(kind, value)| GraphAttachment { kind, value })
                .collect(),
        }
    }

    /// Unchanged values keep their original YAML form, so a no-op patch
    /// leaves the file bytes alone.
    pub fn set_properties(&mut self, props: &[(String, String)]) {
        let current: Vec<(String, String)> = self
            .properties
            .iter()
            .map(|(k, v)| (scalar_string(k), scalar_string(v)))
            .collect();
        if current.as_slice() == props {
            return;
        }
        self.properties = props
            .iter()
            .map(|(k, v)| (Value::String(k.clone()), Value::String(v.clone())))
            .collect();
    }

    /// Replace the relations. Entries with an unknown kind (not in the API) are kept.
    pub fn set_relations(&mut self, relations: &[GraphRelation]) {
        if self.to_api().relations.as_slice() == relations {
            return;
        }
        let unknown: Vec<Mapping> = self
            .relations
            .iter()
            .filter(|m| one_key(m).is_none_or(|(k, _)| RelationKind::parse(&k).is_none()))
            .cloned()
            .collect();
        self.relations = relations
            .iter()
            .map(|r| one_key_map(r.kind.as_str(), &r.target))
            .chain(unknown)
            .collect();
    }

    pub fn set_attachments(&mut self, attachments: &[GraphAttachment]) {
        if self.to_api().attachments.as_slice() == attachments {
            return;
        }
        self.attachments = attachments
            .iter()
            .map(|a| one_key_map(&a.kind, &a.value))
            .collect();
    }

    pub fn set_state(&mut self, state: NodeState) {
        if self.state() != state || self.state.is_some() {
            self.state = Some(state);
        }
    }

    /// Make the file node equal to an API node (keeps `extra` fields).
    pub fn apply_api(&mut self, node: &GraphNode) {
        self.title = node.title.clone();
        self.description = node.description.clone();
        self.set_state(node.state);
        self.set_properties(&node.properties);
        self.set_relations(&node.relations);
        self.set_attachments(&node.attachments);
    }

    pub fn from_api(node: &GraphNode) -> Self {
        let mut file = NodeFile {
            id: node.id.clone(),
            ..Default::default()
        };
        file.apply_api(node);
        file
    }
}

// ============================================================================
// API types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphRelation {
    pub kind: RelationKind,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphAttachment {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub state: NodeState,
    #[serde(default)]
    pub properties: Vec<(String, String)>,
    #[serde(default)]
    pub relations: Vec<GraphRelation>,
    #[serde(default)]
    pub attachments: Vec<GraphAttachment>,
}

/// Input for creating a node (`create_graph_node`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGraphNode {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: Option<NodeState>,
    #[serde(default)]
    pub properties: Option<Vec<(String, String)>>,
    #[serde(default)]
    pub relations: Option<Vec<GraphRelation>>,
    #[serde(default)]
    pub attachments: Option<Vec<GraphAttachment>>,
}

/// Partial node update (`update_graph_node`). Each given list replaces.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodePatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: Option<NodeState>,
    #[serde(default)]
    pub properties: Option<Vec<(String, String)>>,
    #[serde(default)]
    pub relations: Option<Vec<GraphRelation>>,
    #[serde(default)]
    pub attachments: Option<Vec<GraphAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphSummary {
    pub id: String,
    pub title: String,
    pub graph_type: String,
    pub path: String,
    pub location_kind: GraphLocationKind,
    pub repo_root: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub off_default_branch: bool,
    pub missing: bool,
    pub error: Option<String>,
    pub node_count: usize,
    pub unseen_changes: usize,
    pub open_requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServingSession {
    pub session_id: String,
    pub session_name: String,
    pub project_id: String,
    pub worktree_id: String,
    pub worktree_name: String,
    pub status: String,
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeDerived {
    pub active: bool,
    pub blocked: bool,
    pub blockers: Vec<String>,
    pub progress_done: usize,
    pub progress_total: usize,
    pub serving: Vec<ServingSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncomingRelation {
    pub kind: RelationKind,
    pub source: String,
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalNodeRef {
    #[serde(rename = "ref")]
    pub reference: String,
    pub graph_id: String,
    pub graph_title: Option<String>,
    pub node_id: String,
    pub title: Option<String>,
    pub state: Option<NodeState>,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphDetail {
    pub summary: GraphSummary,
    pub nodes: Vec<GraphNode>,
    pub derived: std::collections::HashMap<String, NodeDerived>,
    pub incoming: std::collections::HashMap<String, Vec<IncomingRelation>>,
    pub external: std::collections::HashMap<String, ExternalNodeRef>,
    pub graph_serving: Vec<ServingSession>,
}

/// Who made a change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum GraphActor {
    User,
    Session {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sessionName")]
        session_name: String,
        #[serde(rename = "agentId", default)]
        agent_id: Option<String>,
    },
}

impl GraphActor {
    pub fn is_user(&self) -> bool {
        matches!(self, GraphActor::User)
    }

    pub fn session_id(&self) -> Option<&str> {
        match self {
            GraphActor::User => None,
            GraphActor::Session { session_id, .. } => Some(session_id),
        }
    }

    pub fn session_name(&self) -> Option<&str> {
        match self {
            GraphActor::User => None,
            GraphActor::Session { session_name, .. } => Some(session_name),
        }
    }

    pub fn agent_id(&self) -> Option<&str> {
        match self {
            GraphActor::User => None,
            GraphActor::Session { agent_id, .. } => agent_id.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphChange {
    pub id: String,
    pub graph_id: String,
    pub node_id: Option<String>,
    pub at: u64,
    pub actor: GraphActor,
    /// node.create | node.update | node.state | node.delete | graph.create | graph.update | request.answer | revert
    pub action: String,
    pub summary: String,
    pub why: Option<String>,
    pub before: Option<GraphNode>,
    pub after: Option<GraphNode>,
    #[serde(default)]
    pub reverted_by: Option<String>,
    /// Computed on read; the stored value is ignored.
    #[serde(default)]
    pub seen: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GraphRequestKind {
    AcceptDone,
    Decision,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GraphRequestStatus {
    Open,
    Accepted,
    SentBack,
    Answered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphRequest {
    pub id: String,
    pub graph_id: String,
    pub node_id: String,
    pub kind: GraphRequestKind,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub blocker: Option<String>,
    #[serde(default)]
    pub from_session_id: Option<String>,
    #[serde(default)]
    pub from_session_name: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub created_at: u64,
    pub status: GraphRequestStatus,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub answered_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GraphRequestAction {
    Accept,
    SendBack,
    Answer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphLocationInfo {
    pub path: String,
    pub exists: bool,
    pub location_kind: GraphLocationKind,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub off_default_branch: bool,
}

/// One registry entry (`registry.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RegistryEntry {
    pub id: String,
    pub path: String,
}
