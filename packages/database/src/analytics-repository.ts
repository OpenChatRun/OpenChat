/** What the Analytics page counts: the conversations a workspace started in a period, and the team's replies in them. */
import { rawHandle, type Database } from './internal/handle';
import type { WorkspaceContext } from './context';

export interface AnalyticsConversationRow {
  createdAt: number;
  status: 'open' | 'pending' | 'resolved' | 'archived';
  /** When a person first answered the visitor. Not the AI assistant, and not a note. */
  firstReplyAt: number | null;
  /** 1 when the AI assistant wrote in it. */
  assistant: number;
}

export interface AnalyticsMemberRow {
  memberId: string;
  replies: number;
  conversations: number;
}

/** A period with more than this is counted up to here, oldest first, and says so. */
export const ANALYTICS_MAX_CONVERSATIONS = 10_000;

const COHORT = `SELECT id, workspace_id, created_at, status FROM conversations WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at LIMIT`;
const BY_A_PERSON = `m.sender_type = 'member' AND m.visibility = 'public' AND m.assistant_id IS NULL`;

export function analyticsRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  return {
    /** One batch, so both answers are of the same moment. */
    async period(from: number, to: number): Promise<{ conversations: AnalyticsConversationRow[]; members: AnalyticsMemberRow[]; truncated: boolean }> {
      const [conversations, members] = await d1.batch([
        d1
          .prepare(
            `SELECT c.created_at AS createdAt, c.status,
                    (SELECT MIN(m.created_at) FROM messages m WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND ${BY_A_PERSON}) AS firstReplyAt,
                    EXISTS (SELECT 1 FROM messages m WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.assistant_id IS NOT NULL) AS assistant
               FROM (${COHORT} ?4) c`,
          )
          .bind(ctx.workspaceId, from, to, ANALYTICS_MAX_CONVERSATIONS + 1),
        d1
          .prepare(
            `SELECT m.sender_id AS memberId, COUNT(*) AS replies, COUNT(DISTINCT m.conversation_id) AS conversations
               FROM (${COHORT} ?4) c
               JOIN messages m ON m.workspace_id = c.workspace_id AND m.conversation_id = c.id
              WHERE ${BY_A_PERSON} AND m.sender_id IS NOT NULL
              GROUP BY m.sender_id ORDER BY replies DESC, m.sender_id`,
          )
          .bind(ctx.workspaceId, from, to, ANALYTICS_MAX_CONVERSATIONS),
      ]);
      const rows = conversations!.results as unknown as AnalyticsConversationRow[];
      return { conversations: rows.slice(0, ANALYTICS_MAX_CONVERSATIONS), members: members!.results as unknown as AnalyticsMemberRow[], truncated: rows.length > ANALYTICS_MAX_CONVERSATIONS };
    },
  };
}
