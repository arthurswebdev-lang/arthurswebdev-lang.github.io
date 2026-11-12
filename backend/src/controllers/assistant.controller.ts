import type { NextFunction, Request, Response } from 'express';

import type { IAssistantService } from '../interfaces/assistant-service.interface.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import type {
  AcceptPlan, AssistantReply, SendMessage, SessionIdParams, StartSession, TemplateSummary,
} from '../types/assistant.types.js';
import type { BodyRequest, ParamsRequest } from '../types/request.type.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class AssistantController {
  constructor(private readonly assistantService: IAssistantService) {}

  templates(_request: Request, response: Response<TemplateSummary[]>, next: NextFunction): void {
    SuccessHandlerUtil.handleList(response, next, this.assistantService.templates());
  }

  async start(
    request: BodyRequest<StartSession>,
    response: Response<AssistantReply>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const reply = await this.assistantService.start(currentUserId(response), request.body);
      SuccessHandlerUtil.handleAdd(response, next, reply);
    } catch (error) {
      next(error);
    }
  }

  async send(
    request: BodyRequest<SendMessage, SessionIdParams>,
    response: Response<AssistantReply>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = currentUserId(response);
      const reply = await this.assistantService.send(userId, request.params.id, request.body);
      SuccessHandlerUtil.handleList(response, next, reply);
    } catch (error) {
      next(error);
    }
  }

  async accept(
    request: BodyRequest<AcceptPlan, SessionIdParams>,
    response: Response<AssistantReply>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = currentUserId(response);
      const reply = await this.assistantService.accept(userId, request.params.id, request.body);
      SuccessHandlerUtil.handleList(response, next, reply);
    } catch (error) {
      next(error);
    }
  }

  async close(
    request: ParamsRequest<SessionIdParams>,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.assistantService.close(currentUserId(response), request.params.id);
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
