use std::path::Path;
use std::process::Command;

use serde_json::json;
use tauri::AppHandle;

use super::derive::{derive, OtherGraph, ServingEntry};
use super::*;

fn app() -> (tempfile::TempDir, AppHandle) {
    let temp = tempfile::tempdir().unwrap();
    let app = AppHandle::new(temp.path().join("data"), temp.path().into()).unwrap();
    (temp, app)
}

fn path_in(temp: &tempfile::TempDir, name: &str) -> String {
    temp.path().join(name).to_string_lossy().to_string()
}

async fn new_graph(app: &AppHandle, temp: &tempfile::TempDir) -> String {
    create_graph(
        app.clone(),
        "Roadmap".into(),
        "roadmap".into(),
        path_in(temp, "roadmap.yml"),
    )
    .await
    .unwrap()
    .id
}

fn new_node(title: &str) -> NewGraphNode {
    NewGraphNode {
        title: title.into(),
        ..Default::default()
    }
}

fn rel(kind: RelationKind, target: &str) -> GraphRelation {
    GraphRelation {
        kind,
        target: target.into(),
    }
}

fn node(id: &str, state: NodeState, relations: Vec<GraphRelation>) -> GraphNode {
    GraphNode {
        id: id.into(),
        title: format!("T-{id}"),
        description: String::new(),
        state,
        properties: vec![],
        relations,
        attachments: vec![],
    }
}

// ============================================================================
// File format
// ============================================================================

const SAMPLE: &str = r#"id: 3f2c9e1a-0000-4000-8000-000000000000
title: Splitkick roadmap
type: roadmap
nodes:
- id: k7m2qd
  title: Graph support v1
  description: |
    Two lines
    of text.
  state: committed
  properties:
    quarter: 2027-Q1
    area: ui
  relations:
  - depends-on: x91ffa
  - blocked-by: 'decision: storage for multi-machine sync'
  attachments:
  - issue: azeitler/splitkick#78
  - figma: https://example.com/f
  estimate: 3
- id: x91ffa
  title: Design
owner: andreas
"#;

#[test]
fn yaml_round_trip_keeps_order_and_unknown_fields() {
    let graph = store::parse_graph(SAMPLE).unwrap();
    assert_eq!(graph.nodes[0].id, "k7m2qd");
    assert_eq!(graph.nodes[1].id, "x91ffa");
    assert_eq!(graph.nodes[1].state, None);
    assert_eq!(graph.extra.len(), 1);
    assert_eq!(graph.nodes[0].extra.len(), 1);

    let api = graph.nodes[0].to_api();
    assert_eq!(
        api.properties,
        vec![
            ("quarter".to_string(), "2027-Q1".to_string()),
            ("area".to_string(), "ui".to_string())
        ]
    );
    assert_eq!(api.attachments[1].kind, "figma");
    assert_eq!(api.relations[1].kind, RelationKind::BlockedBy);

    let text = store::serialize_graph(&graph).unwrap();
    assert_eq!(text, SAMPLE, "a parsed file writes back byte-identical");
    let again = store::parse_graph(&text).unwrap();
    assert_eq!(again, graph);
}

#[test]
fn applying_the_same_api_node_changes_nothing() {
    let graph = store::parse_graph(SAMPLE).unwrap();
    let mut copy = graph.clone();
    for n in &mut copy.nodes {
        let api = n.to_api();
        n.apply_api(&api);
    }
    assert_eq!(copy, graph);
}

#[test]
fn unknown_relation_kinds_survive_a_relations_patch() {
    let mut file: NodeFile =
        serde_yaml::from_str("id: a1\ntitle: A\nrelations:\n- supersedes: b2\n- part-of: r1\n")
            .unwrap();
    file.set_relations(&[rel(RelationKind::DependsOn, "c3")]);
    let text = serde_yaml::to_string(&file).unwrap();
    assert!(text.contains("depends-on: c3"));
    assert!(text.contains("supersedes: b2"));
    assert!(!text.contains("part-of"));
}

#[tokio::test]
async fn editing_one_node_leaves_other_lines_identical() {
    let (temp, app) = app();
    let gid = new_graph(&app, &temp).await;
    let mut ids = Vec::new();
    for t in ["One", "Two", "Three"] {
        let mut n = new_node(t);
        n.properties = Some(vec![("k".into(), "v".into())]);
        ids.push(
            create_node(&app, &gid, n, &GraphActor::User, None)
                .unwrap()
                .id,
        );
    }
    let path = temp.path().join("roadmap.yml");
    let before = std::fs::read_to_string(&path).unwrap();
    let patch = GraphNodePatch {
        title: Some("Two renamed".into()),
        ..Default::default()
    };
    update_node(&app, &gid, &ids[1], patch, &GraphActor::User, None).unwrap();
    let after = std::fs::read_to_string(&path).unwrap();

    let b: Vec<&str> = before.lines().collect();
    let a: Vec<&str> = after.lines().collect();
    assert_eq!(a.len(), b.len());
    let diff: Vec<usize> = (0..a.len()).filter(|i| a[*i] != b[*i]).collect();
    assert_eq!(diff.len(), 1, "{before}\n---\n{after}");
    assert!(a[diff[0]].contains("Two renamed"));
}

#[test]
fn node_ids_are_six_chars_with_a_letter_and_unique() {
    let mut graph = GraphFile::default();
    for _ in 0..200 {
        let id = new_node_id(&graph);
        assert_eq!(id.len(), 6);
        assert!(id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        assert!(id.chars().any(|c| c.is_ascii_alphabetic()));
        assert!(!graph.nodes.iter().any(|n| n.id == id));
        graph.nodes.push(NodeFile {
            id,
            ..Default::default()
        });
    }
}

// ============================================================================
// Derived values
// ============================================================================

fn serving(id: &str, status: &str, serves: &[&str]) -> ServingEntry {
    ServingEntry {
        serves: serves.iter().map(|s| s.to_string()).collect(),
        session: ServingSession {
            session_id: id.into(),
            session_name: id.into(),
            project_id: "p".into(),
            worktree_id: "w".into(),
            worktree_name: "w".into(),
            status: status.into(),
            agent_id: None,
        },
    }
}

#[test]
fn derives_blocked_progress_incoming_and_serving() {
    let nodes = vec![
        node("root01", NodeState::Committed, vec![]),
        node(
            "aaaaa1",
            NodeState::Done,
            vec![rel(RelationKind::PartOf, "root01")],
        ),
        node(
            "bbbbb2",
            NodeState::Proposed,
            vec![
                rel(RelationKind::PartOf, "root01"),
                rel(RelationKind::DependsOn, "ccccc3"),
                rel(RelationKind::BlockedBy, "decision: storage"),
                rel(RelationKind::DependsOn, "g2#ext001"),
            ],
        ),
        node(
            "ccccc3",
            NodeState::Committed,
            vec![rel(RelationKind::PartOf, "root01")],
        ),
        node(
            "ddddd4",
            NodeState::Dropped,
            vec![rel(RelationKind::PartOf, "root01")],
        ),
        node(
            "eeeee5",
            NodeState::Proposed,
            vec![rel(RelationKind::DependsOn, "aaaaa1")],
        ),
    ];
    let others = vec![OtherGraph {
        id: "g2".into(),
        title: "Other".into(),
        nodes: vec![
            node("ext001", NodeState::Proposed, vec![]),
            node(
                "ext002",
                NodeState::Done,
                vec![rel(RelationKind::PartOf, "g1#root01")],
            ),
        ],
    }];
    let sessions = vec![
        serving("s1", "running", &["g1#bbbbb2"]),
        serving("s2", "idle", &["g1#ccccc3"]),
        serving("s3", "idle", &["g1"]),
        serving("s4", "running", &["other#bbbbb2"]),
    ];
    let d = derive("g1", &nodes, &others, &sessions);

    let b = &d.derived["bbbbb2"];
    assert!(b.blocked);
    assert_eq!(
        b.blockers,
        vec![
            "depends-on T-ccccc3".to_string(),
            "blocked-by decision: storage".to_string(),
            "depends-on T-ext001".to_string(),
        ]
    );
    assert!(b.active);
    assert_eq!(b.serving.len(), 1);
    assert!(!d.derived["ccccc3"].active);
    assert!(
        !d.derived["eeeee5"].blocked,
        "a done dependency does not block"
    );

    // part-of children: aaaaa1 done, bbbbb2, ccccc3, ext002 done (other graph); dropped excluded.
    let root = &d.derived["root01"];
    assert_eq!((root.progress_done, root.progress_total), (2, 4));

    let incoming = &d.incoming["root01"];
    assert_eq!(incoming.len(), 5);
    assert!(incoming
        .iter()
        .any(|i| i.external && i.source == "g2#ext002" && i.kind == RelationKind::PartOf));
    assert!(d.external["g2#ext001"].found);
    assert_eq!(
        d.external["g2#ext001"].graph_title.as_deref(),
        Some("Other")
    );
    assert!(d.external.contains_key("g2#ext002"));
    assert_eq!(d.graph_serving.len(), 1);
    assert_eq!(d.graph_serving[0].session_id, "s3");
}

// ============================================================================
// Change log and revert
// ============================================================================

#[tokio::test]
async fn change_log_and_revert() {
    let (temp, app) = app();
    let gid = new_graph(&app, &temp).await;
    let n = create_node(&app, &gid, new_node("First"), &GraphActor::User, None).unwrap();
    let agent = GraphActor::Session {
        session_id: "s1".into(),
        session_name: "Agent".into(),
        agent_id: Some("a1".into()),
    };
    let patch = GraphNodePatch {
        title: Some("Second".into()),
        ..Default::default()
    };
    update_node(&app, &gid, &n.id, patch, &agent, Some("clearer".into())).unwrap();
    set_node_state(
        &app,
        &gid,
        &n.id,
        NodeState::Committed,
        &agent,
        Some("go".into()),
    )
    .unwrap();

    let changes = list_graph_changes(app.clone(), gid.clone()).await.unwrap();
    let actions: Vec<&str> = changes.iter().map(|c| c.action.as_str()).collect();
    assert_eq!(actions, vec!["node.state", "node.update", "node.create"]);
    assert!(!changes[0].seen && !changes[1].seen && changes[2].seen);
    assert_eq!(changes[1].why.as_deref(), Some("clearer"));

    // The title change is older than the state change: revert refuses.
    let err = revert_graph_change(app.clone(), gid.clone(), changes[1].id.clone())
        .await
        .unwrap_err();
    assert!(err.contains("changed after"), "{err}");

    // Revert the newest one, then the title change.
    revert_graph_change(app.clone(), gid.clone(), changes[0].id.clone())
        .await
        .unwrap();
    assert_eq!(
        read_node(&app, &gid, &n.id).unwrap().state,
        NodeState::Proposed
    );
    revert_graph_change(app.clone(), gid.clone(), changes[1].id.clone())
        .await
        .unwrap();
    assert_eq!(read_node(&app, &gid, &n.id).unwrap().title, "First");

    let changes = list_graph_changes(app.clone(), gid.clone()).await.unwrap();
    assert_eq!(changes[0].action, "revert");
    let original = changes.iter().find(|c| c.action == "node.state").unwrap();
    assert!(original.reverted_by.is_some());
    assert!(
        revert_graph_change(app.clone(), gid.clone(), original.id.clone())
            .await
            .is_err(),
        "a change is reverted only once"
    );

    // Seen: reverting a change marks it seen; "mark all" covers the rest.
    assert_eq!(changes::unseen_count(&app, &gid), 0);
    set_node_state(
        &app,
        &gid,
        &n.id,
        NodeState::Done,
        &agent,
        Some("shipped".into()),
    )
    .unwrap();
    assert_eq!(changes::unseen_count(&app, &gid), 1);
    mark_graph_changes_seen(app.clone(), gid.clone(), None)
        .await
        .unwrap();
    assert_eq!(changes::unseen_count(&app, &gid), 0);
}

#[tokio::test]
async fn revert_of_create_and_delete() {
    let (temp, app) = app();
    let gid = new_graph(&app, &temp).await;
    let a = create_node(&app, &gid, new_node("A"), &GraphActor::User, None).unwrap();
    let mut b_in = new_node("B");
    b_in.relations = Some(vec![rel(RelationKind::DependsOn, &a.id)]);
    let b = create_node(&app, &gid, b_in, &GraphActor::User, None).unwrap();

    delete_graph_node(app.clone(), gid.clone(), a.id.clone(), None)
        .await
        .unwrap();
    assert!(read_node(&app, &gid, &b.id).unwrap().relations.is_empty());

    let changes = list_graph_changes(app.clone(), gid.clone()).await.unwrap();
    assert_eq!(changes[0].action, "node.delete");
    revert_graph_change(app.clone(), gid.clone(), changes[0].id.clone())
        .await
        .unwrap();
    assert_eq!(read_node(&app, &gid, &a.id).unwrap().title, "A");

    let create_b = changes
        .iter()
        .find(|c| c.action == "node.create" && c.node_id.as_deref() == Some(b.id.as_str()))
        .unwrap();
    // B lost its relation in the delete, so it no longer matches its creation.
    assert!(
        revert_graph_change(app.clone(), gid.clone(), create_b.id.clone())
            .await
            .is_err()
    );
    let create_a = changes
        .iter()
        .find(|c| c.action == "node.create" && c.node_id.as_deref() == Some(a.id.as_str()))
        .unwrap();
    revert_graph_change(app.clone(), gid.clone(), create_a.id.clone())
        .await
        .unwrap();
    assert!(read_node(&app, &gid, &a.id).is_err());
}

// ============================================================================
// Requests
// ============================================================================

fn add_session(app: &AppHandle, session_id: &str) {
    crate::chat::storage::with_sessions_mut(app, "", "wt1", |stored| {
        let mut session = crate::chat::types::Session::new(
            "Worker".to_string(),
            0,
            crate::chat::types::Backend::Claude,
        );
        session.id = session_id.to_string();
        stored.sessions.push(session);
        Ok(())
    })
    .unwrap();
}

#[tokio::test]
async fn request_answer_flows() {
    let (temp, app) = app();
    add_session(&app, "s1");
    let gid = new_graph(&app, &temp).await;
    let mut input = new_node("Ship it");
    input.relations = Some(vec![rel(RelationKind::BlockedBy, "storage?")]);
    let n = create_node(&app, &gid, input, &GraphActor::User, None).unwrap();
    let actor = permissions::session_actor(&app, "s1");

    // accept-done → done
    let r = create_request(
        &app,
        &gid,
        &n.id,
        GraphRequestKind::AcceptDone,
        "Done?".into(),
        None,
        vec!["PR #1".into()],
        vec![],
        None,
        &actor,
    )
    .unwrap();
    assert_eq!(r.from_session_name.as_deref(), Some("Worker"));
    let r = answer_graph_request(
        app.clone(),
        gid.clone(),
        r.id,
        GraphRequestAction::Accept,
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, GraphRequestStatus::Accepted);
    assert_eq!(read_node(&app, &gid, &n.id).unwrap().state, NodeState::Done);

    // decision → blocker removed, note added, follow-up in the session
    let r = create_request(
        &app,
        &gid,
        &n.id,
        GraphRequestKind::Decision,
        "Which storage?".into(),
        Some("pick one".into()),
        vec![],
        vec!["git".into(), "cloud".into()],
        Some("storage?".into()),
        &actor,
    )
    .unwrap();
    assert!(answer_graph_request(
        app.clone(),
        gid.clone(),
        r.id.clone(),
        GraphRequestAction::Accept,
        None
    )
    .await
    .is_err());
    let r = answer_graph_request(
        app.clone(),
        gid.clone(),
        r.id,
        GraphRequestAction::Answer,
        Some("git".into()),
    )
    .await
    .unwrap();
    assert_eq!(r.status, GraphRequestStatus::Answered);
    let node = read_node(&app, &gid, &n.id).unwrap();
    assert!(node.relations.is_empty());
    assert_eq!(node.attachments[0].kind, "note");
    assert_eq!(node.attachments[0].value, "Decision: storage? → git");
    let metadata = crate::chat::storage::load_metadata(&app, "s1")
        .unwrap()
        .unwrap();
    assert_eq!(metadata.follow_ups.len(), 1);
    assert!(metadata.follow_ups[0].text.contains("git"));

    // send-back keeps the state and adds a follow-up
    let r = create_request(
        &app,
        &gid,
        &n.id,
        GraphRequestKind::AcceptDone,
        "Again?".into(),
        None,
        vec![],
        vec![],
        None,
        &actor,
    )
    .unwrap();
    let r = answer_graph_request(
        app.clone(),
        gid.clone(),
        r.id,
        GraphRequestAction::SendBack,
        Some("tests missing".into()),
    )
    .await
    .unwrap();
    assert_eq!(r.status, GraphRequestStatus::SentBack);
    let metadata = crate::chat::storage::load_metadata(&app, "s1")
        .unwrap()
        .unwrap();
    assert_eq!(metadata.follow_ups.len(), 2);

    let all = list_graph_requests(app.clone(), None).await.unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(requests::open_count(&app, &gid), 0);
    let changes = list_graph_changes(app.clone(), gid.clone()).await.unwrap();
    assert_eq!(
        changes
            .iter()
            .filter(|c| c.action == "request.answer")
            .count(),
        3
    );
}

// ============================================================================
// Registry and files
// ============================================================================

#[tokio::test]
async fn registry_add_and_remove() {
    let (temp, app) = app();
    let gid = new_graph(&app, &temp).await;
    let list = list_graphs(app.clone()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "Roadmap");
    assert_eq!(list[0].graph_type, "roadmap");
    assert_eq!(list[0].location_kind, GraphLocationKind::Folder);

    assert!(create_graph(
        app.clone(),
        "Dup".into(),
        String::new(),
        path_in(&temp, "roadmap.yml")
    )
    .await
    .is_err());
    assert!(
        create_graph(app.clone(), "Bad".into(), String::new(), "rel.yml".into())
            .await
            .is_err()
    );

    let s = update_graph(app.clone(), gid.clone(), Some("Renamed".into()), None)
        .await
        .unwrap();
    assert_eq!(s.title, "Renamed");

    remove_graph(app.clone(), gid.clone()).await.unwrap();
    assert!(list_graphs(app.clone()).await.unwrap().is_empty());
    assert!(temp.path().join("roadmap.yml").exists(), "the file stays");

    // Missing file shows as missing.
    let s = open_graph_file(app.clone(), path_in(&temp, "roadmap.yml"))
        .await
        .unwrap();
    assert_eq!(s.id, gid);
    std::fs::remove_file(temp.path().join("roadmap.yml")).unwrap();
    let list = list_graphs(app.clone()).await.unwrap();
    assert!(list[0].missing);
}

#[tokio::test]
async fn open_graph_file_adds_an_id_when_missing() {
    let (temp, app) = app();
    let path = temp.path().join("hand.yml");
    std::fs::write(
        &path,
        "title: Hand made\nnodes:\n- id: a1b2c3\n  title: X\n",
    )
    .unwrap();
    let s = open_graph_file(app.clone(), path.to_string_lossy().to_string())
        .await
        .unwrap();
    assert_eq!(s.title, "Hand made");
    assert_eq!(s.node_count, 1);
    assert!(uuid::Uuid::parse_str(&s.id).is_ok());
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.starts_with(&format!("id: {}\n", s.id)));

    // Opening it again keeps the id and one registry entry.
    let again = open_graph_file(app.clone(), path.to_string_lossy().to_string())
        .await
        .unwrap();
    assert_eq!(again.id, s.id);
    assert_eq!(store::load_registry(&app).unwrap().len(), 1);
}

#[tokio::test]
async fn poller_ignores_own_writes_and_sees_outside_edits() {
    let (temp, app) = app();
    let gid = new_graph(&app, &temp).await;
    store::poll_once_for_test(&app);
    create_node(&app, &gid, new_node("Ours"), &GraphActor::User, None).unwrap();
    assert!(!store::poll_once_for_test(&app));
    std::thread::sleep(std::time::Duration::from_millis(20));
    let path = temp.path().join("roadmap.yml");
    let text = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, text.replace("Ours", "Theirs")).unwrap();
    assert!(store::poll_once_for_test(&app));
    assert!(!store::poll_once_for_test(&app));
}

#[test]
fn poller_reports_runs_starting_and_ending() {
    // `active` is derived from running sessions; their start and end touch
    // no graph file, so the poller reports them on their own.
    store::running_sessions_changed_for_test(Vec::new());
    assert!(!store::running_sessions_changed_for_test(Vec::new()));
    assert!(store::running_sessions_changed_for_test(vec!["s1".into()]));
    assert!(!store::running_sessions_changed_for_test(vec!["s1".into()]));
    assert!(store::running_sessions_changed_for_test(Vec::new()));
}

// ============================================================================
// Location
// ============================================================================

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(status.status.success(), "git {args:?}: {status:?}");
}

#[tokio::test]
async fn location_detection_and_commit() {
    let (temp, app) = app();
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-b", "main"]);
    git(&repo, &["config", "user.name", "t"]);
    git(&repo, &["config", "user.email", "t@t"]);
    git(&repo, &["config", "commit.gpgsign", "false"]);
    std::fs::write(repo.join("README"), "x").unwrap();
    git(&repo, &["add", "README"]);
    git(&repo, &["commit", "-m", "init"]);

    let data: crate::projects::types::ProjectsData = serde_json::from_value(json!({
        "projects": [{
            "id": "p1", "name": "proj", "path": repo, "default_branch": "main",
            "added_at": 0, "order": 0,
        }],
        "worktrees": [],
    }))
    .unwrap();
    crate::projects::storage::save_projects_data(&app, &data).unwrap();

    let file = repo.join("docs/roadmap.yml").to_string_lossy().to_string();
    let info = get_graph_location_info(app.clone(), file.clone())
        .await
        .unwrap();
    assert_eq!(info.location_kind, GraphLocationKind::ProjectRepo);
    assert_eq!(info.project_id.as_deref(), Some("p1"));
    assert_eq!(info.branch.as_deref(), Some("main"));
    assert!(!info.off_default_branch);
    assert!(!info.exists);

    git(&repo, &["checkout", "-b", "feature"]);
    let info = get_graph_location_info(app.clone(), file.clone())
        .await
        .unwrap();
    assert_eq!(info.branch.as_deref(), Some("feature"));
    assert_eq!(info.default_branch.as_deref(), Some("main"));
    assert!(info.off_default_branch);

    // Another repo, and a plain folder.
    let other = temp.path().join("other");
    std::fs::create_dir_all(&other).unwrap();
    git(&other, &["init", "-b", "trunk"]);
    let info = get_graph_location_info(
        app.clone(),
        other.join("g.yml").to_string_lossy().to_string(),
    )
    .await
    .unwrap();
    assert_eq!(info.location_kind, GraphLocationKind::OtherRepo);
    assert!(!info.off_default_branch);
    assert!(info.project_id.is_none());

    // Commit only the graph file.
    std::fs::write(repo.join("other.txt"), "unrelated").unwrap();
    git(&repo, &["add", "other.txt"]);
    let s = create_graph(app.clone(), "Plan".into(), "plan".into(), file.clone())
        .await
        .unwrap();
    let sha = commit_graph(app.clone(), s.id.clone(), None).await.unwrap();
    assert_eq!(sha.len(), 40);
    let out = Command::new("git")
        .args(["show", "--name-only", "--format=%s", "HEAD"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let out = String::from_utf8_lossy(&out.stdout);
    assert!(out.contains("graph: update Plan"), "{out}");
    assert!(out.contains("docs/roadmap.yml"));
    assert!(!out.contains("other.txt"), "other staged files stay out");

    // Through a symlinked folder (/tmp → /private/tmp), the root keeps the
    // spelling of the path, so the UI can show the path relative to it.
    #[cfg(unix)]
    {
        let link = temp.path().join("link");
        std::os::unix::fs::symlink(&repo, &link).unwrap();
        let linked = link.join("docs/roadmap.yml").to_string_lossy().to_string();
        let info = get_graph_location_info(app.clone(), linked).await.unwrap();
        assert_eq!(info.repo_root, Some(link.to_string_lossy().to_string()));
        assert_eq!(info.location_kind, GraphLocationKind::ProjectRepo);
    }

    // A second commit with no change says so instead of a bare git failure.
    let err = commit_graph(app.clone(), s.id.clone(), None)
        .await
        .unwrap_err();
    assert_eq!(err, "Nothing to commit: docs/roadmap.yml has no changes");
}

// ============================================================================
// Session metadata
// ============================================================================

#[test]
fn session_graph_fields_reach_session_and_are_not_synced_back() {
    use crate::chat::types::SessionMetadata;
    let fresh = SessionMetadata::new("s".into(), "wt".into(), "S".into(), 0);
    let json = serde_json::to_value(&fresh).unwrap();
    assert!(json.get("serves").is_none());
    assert!(json.get("agent_id").is_none());
    let mut m: SessionMetadata = serde_json::from_value(json).unwrap();
    assert!(m.serves.is_empty());

    m.serves = vec!["g1#a1b2c3".into()];
    m.agent_id = Some("a1".into());
    m.graph_permission = Some("write".into());
    let mut session = m.to_session();
    assert_eq!(session.serves, vec!["g1#a1b2c3".to_string()]);
    assert_eq!(session.agent_id.as_deref(), Some("a1"));
    assert_eq!(session.graph_permission.as_deref(), Some("write"));

    session.serves.clear();
    session.agent_id = None;
    session.graph_permission = None;
    m.update_from_session(&session);
    assert_eq!(m.serves.len(), 1);
    assert_eq!(m.agent_id.as_deref(), Some("a1"));
    assert_eq!(m.graph_permission.as_deref(), Some("write"));
}

#[tokio::test]
async fn session_metadata_commands() {
    let (_temp, app) = app();
    add_session(&app, "s1");
    set_session_serves(
        app.clone(),
        "s1".into(),
        vec!["g1#a".into(), " g1#a ".into(), "g1".into()],
    )
    .await
    .unwrap();
    let m = crate::chat::storage::load_metadata(&app, "s1")
        .unwrap()
        .unwrap();
    assert_eq!(m.serves, vec!["g1#a".to_string(), "g1".to_string()]);

    assert_eq!(effective_permission(&app, "s1"), GraphPermission::Read);
    set_session_graph_permission(app.clone(), "s1".into(), GraphPermission::Manage)
        .await
        .unwrap();
    assert_eq!(effective_permission(&app, "s1"), GraphPermission::Manage);
    assert_eq!(effective_permission(&app, "anon"), GraphPermission::Read);

    assert!(
        set_session_agent(app.clone(), "s1".into(), Some("nope".into()), None)
            .await
            .is_err()
    );
    set_session_agent(app.clone(), "s1".into(), None, None)
        .await
        .unwrap();
    assert_eq!(effective_permission(&app, "s1"), GraphPermission::Read);
}

#[test]
fn serves_edit_adds_removes_and_cleans() {
    let current = vec!["g1#a".to_string(), "g1".to_string()];
    let change = ServesEdit::Change {
        add: vec![" g2 ".into(), "g1#a".into(), String::new()],
        remove: vec!["g1".into(), "missing".into()],
    };
    assert_eq!(
        change.apply(&current),
        vec!["g1#a".to_string(), "g2".to_string()]
    );
    let replace = ServesEdit::Replace(vec!["g3".into(), "g3".into()]);
    assert_eq!(replace.apply(&current), vec!["g3".to_string()]);
}

#[tokio::test]
async fn change_session_serves_returns_the_resulting_list() {
    let (_temp, app) = app();
    add_session(&app, "s1");
    set_session_serves(app.clone(), "s1".into(), vec!["g1#a".into()])
        .await
        .unwrap();
    let after = change_session_serves(
        app.clone(),
        "s1".into(),
        vec!["g2".into()],
        vec!["g1#a".into(), "g9".into()],
    )
    .await
    .unwrap();
    assert_eq!(after, vec!["g2".to_string()]);
    assert!(
        change_session_serves(app.clone(), "nope".into(), vec![], vec![])
            .await
            .is_err()
    );
}

/// Issue #101: the UI marks a session opened (set_active_session,
/// set_session_last_opened, the bulk variant) all the time. Each did
/// load_metadata + save_metadata without the lock across both, so a
/// permission change between the two calls was lost.
#[test]
fn permission_change_survives_concurrent_open_marks() {
    use std::sync::atomic::{AtomicBool, Ordering};

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(future)
    }

    let (_temp, app) = app();
    add_session(&app, "s1");
    let stop = AtomicBool::new(false);
    let mut lost = 0;
    std::thread::scope(|scope| {
        let markers: [fn(AppHandle) -> Result<(), String>; 3] = [
            |app| block_on(crate::chat::set_session_last_opened(app, "s1".into())),
            |app| {
                block_on(crate::chat::set_active_session(
                    app,
                    "wt1".into(),
                    String::new(),
                    "s1".into(),
                ))
            },
            |app| {
                block_on(crate::chat::set_sessions_last_opened_bulk(
                    app,
                    vec!["s1".into()],
                ))
            },
        ];
        for mark in markers {
            let (app, stop) = (app.clone(), &stop);
            scope.spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    mark(app.clone()).unwrap();
                }
            });
        }
        for i in 0..300 {
            let permission = if i % 2 == 0 {
                GraphPermission::Write
            } else {
                GraphPermission::Manage
            };
            block_on(set_session_graph_permission(
                app.clone(),
                "s1".into(),
                permission,
            ))
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1));
            if effective_permission(&app, "s1") != permission {
                lost += 1;
            }
        }
        stop.store(true, Ordering::Relaxed);
    });
    assert_eq!(lost, 0, "lost {lost} of 300 permission changes");
}
