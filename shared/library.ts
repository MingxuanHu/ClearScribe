export interface Conversation {
  id: string;
  title: string;
  description: string;
  recordedAt: string;
  files: string[];
  active: boolean;
  metadataWarning?: string;
}
export interface ConversationDetail extends Conversation { transcript: string }
