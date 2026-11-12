import type {
  AcceptPlan, AssistantReply, SendMessage, StartSession, TemplateSummary,
} from '../types/assistant.types.js';

export interface IAssistantService {
  templates(): TemplateSummary[];
  start(userId: string, input: StartSession): Promise<AssistantReply>;
  send(userId: string, sessionId: string, input: SendMessage): Promise<AssistantReply>;
  accept(userId: string, sessionId: string, input: AcceptPlan): Promise<AssistantReply>;
  close(userId: string, sessionId: string): Promise<void>;
}
