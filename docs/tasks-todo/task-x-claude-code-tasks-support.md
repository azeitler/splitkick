# Support New Claude Code Tasks Format

## Summary

Claude Code upgraded TodoWrite → Tasks. New format stores tasks in `~/.claude/tasks/<session-id>/<task-id>.json` files instead of inline in tool call input.

## Changes

### 1. Types (`src/types/chat.ts`)

```ts
interface ClaudeTask {
  id: string
  subject: string
  description: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
  blocks: string[]
  blockedBy: string[]
}
```

Add type guards: `isTaskCreate`, `isTaskUpdate`, `isTaskList`, `isTaskGet`

### 2. Rust Command (`src-tauri/src/chat/commands.rs`)

```rust
#[tauri::command]
async fn read_claude_tasks(claude_session_id: String) -> Result<Vec<ClaudeTask>, String>
```

- Read `~/.claude/tasks/<session-id>/*.json`
- Return sorted by id

### 3. Tool Utils (`src/components/chat/tool-call-utils.ts`)

- Add `TaskCreate|TaskUpdate|TaskList|TaskGet` to `isSpecialTool()`

### 4. Separate Widgets Approach

**TodoWidget changes:**

- Rename header from "Tasks" → "Todos"
- Keep same look and functionality

**New TaskWidget:**

- Same visual style as TodoWidget
- Header shows "Tasks"
- Display `subject` instead of `content`

**Layout in ChatWindow:**

- When both exist: side by side, each 50% width
- When only one: full width (current behavior)
- Both positioned above textarea

### 5. ChatWindow (`src/components/chat/ChatWindow.tsx`)

- Detect Task tool calls → call `read_claude_tasks(claude_session_id)`
- Show TaskWidget when tasks exist, TodoWidget when todos exist
- Both can coexist for backward compat

## Files

| File                                     | Change                                    |
| ---------------------------------------- | ----------------------------------------- |
| `src/types/chat.ts`                      | Add ClaudeTask interface + type guards    |
| `src-tauri/src/chat/commands.rs`         | Add read_claude_tasks command             |
| `src-tauri/src/chat/types.rs`            | Add task_list_id to SessionMetadata       |
| `src-tauri/src/chat/claude.rs`           | Pass CLAUDE_CODE_TASK_LIST_ID env var     |
| `src/types/ui-state.ts`                  | Add task_list_id persistence              |
| `src/components/chat/tool-call-utils.ts` | Add Task tools to isSpecialTool           |
| `src/components/chat/TaskWidget.tsx`     | New component                             |
| `src/components/chat/TodoWidget.tsx`     | Rename header "Tasks" → "Todos"           |
| `src/components/chat/ChatWindow.tsx`     | Integrate TaskWidget, side-by-side layout |

## Task List ID Support

The `CLAUDE_CODE_TASK_LIST_ID` env var allows multiple sessions to share a task list:

- Tasks stored in `~/.claude/tasks/<TASK_LIST_ID>/` instead of session ID
- Multiple Claude instances can collaborate on same tasks

### Additional Changes for Task List ID

1. **Session Metadata** (`src-tauri/src/chat/types.rs`)
   - Add `task_list_id: Option<String>` to SessionMetadata

2. **UI State** (`src/types/ui-state.ts`)
   - Add `task_list_id` for persistence

3. **Claude Spawn** (`src-tauri/src/chat/claude.rs`)
   - Pass `CLAUDE_CODE_TASK_LIST_ID` env var when `task_list_id` is set

4. **Task Reading**
   - `read_claude_tasks(session_id, task_list_id)` - prefer `task_list_id` if set

5. **Session Settings UI** (optional)
   - Add field to configure shared task list ID per session

## Verification

1. Start Claude CLI session with TaskCreate
2. Verify `~/.claude/tasks/<session-id>/1.json` created
3. Verify TaskWidget renders in Jean
4. Update task → verify UI updates
5. Old TodoWrite sessions still render TodoWidget
