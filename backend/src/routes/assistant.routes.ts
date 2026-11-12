import {
  type NextFunction, type Request, type RequestHandler, type Response, Router,
} from 'express';

import type { AssistantController } from '../controllers/assistant.controller.js';
import {
  validateAccept, validateClose, validateSend, validateStart,
} from '../middlewares/validation/assistant.validation.middleware.js';
import { ServiceUnavailableError } from '../utils/http-errors/service-unavailable.error.js';

/**
 * Answers 503 when the assistant is off — no Claude key, or FEATURE_ASSISTANT
 * set to off — before anything else runs.
 * The frontend reads that from the templates call and hides the button.
 */
function requireConfigured(configured: boolean): RequestHandler {
  return (_request: Request, _response: Response, next: NextFunction): void => {
    next(configured ? undefined : new ServiceUnavailableError('The assistant is not configured.'));
  };
}

export class AssistantRoutes {
  private readonly router = Router();

  constructor(
    private readonly assistantController: AssistantController | null,
    private readonly authenticate: RequestHandler,
  ) {}

  initRoutes(): Router {
    const controller = this.assistantController;
    const gate = [requireConfigured(controller !== null), this.authenticate];
    if (controller === null) {
      this.router.use('/assistant', ...gate);

      return this.router;
    }

    this.router.get('/assistant/templates', ...gate, controller.templates.bind(controller));
    this.router.get('/assistant/health', ...gate, controller.health.bind(controller));
    this.router.post('/assistant/sessions', ...gate, validateStart, controller.start.bind(controller));
    this.router.post('/assistant/sessions/:id/messages', ...gate, validateSend, controller.send.bind(controller));
    this.router.post('/assistant/sessions/:id/accept', ...gate, validateAccept, controller.accept.bind(controller));
    this.router.delete('/assistant/sessions/:id', ...gate, validateClose, controller.close.bind(controller));

    return this.router;
  }
}
