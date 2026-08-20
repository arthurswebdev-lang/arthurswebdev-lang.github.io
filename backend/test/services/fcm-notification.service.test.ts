import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Messaging } from 'firebase-admin/messaging';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { TaskStatus } from '../../src/enum/task-status.enum.js';
import type { IDevicesRepository } from '../../src/interfaces/devices-repository.interface.js';
import { FcmNotificationService } from '../../src/services/fcm-notification.service.js';
import type { Device, RegisterDevice } from '../../src/types/device.types.js';
import { anEvent, TEST_USER_ID } from '../support/tasks.js';

/** The error shape firebase-admin throws: an Error carrying a `code`. */
function fcmError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function aDevice(token: string): Device {
  return {
    id: `device-${token}`,
    userId: TEST_USER_ID,
    token,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

class FakeDevicesRepository implements IDevicesRepository {
  readonly deleted: string[] = [];

  constructor(private devices: Device[]) {}

  ensureIndexes(): Promise<void> {
    return Promise.resolve();
  }

  listByUserId(userId: string): Promise<Device[]> {
    return Promise.resolve(this.devices.filter((device) => device.userId === userId));
  }

  upsert(input: RegisterDevice, userId: string): Promise<Device> {
    return Promise.resolve({ ...aDevice(input.token), userId });
  }

  deleteByToken(token: string): Promise<boolean> {
    this.deleted.push(token);
    this.devices = this.devices.filter((device) => device.token !== token);

    return Promise.resolve(true);
  }
}

interface SentMessage {
  token: string;
  title: string;
  body: string;
  link: string | undefined;
}

/** Stands in for `Messaging`, failing whichever tokens the test names. */
function fakeMessaging(sent: SentMessage[], failures: Record<string, string> = {}): Messaging {
  return {
    send: (message: {
      token: string;
      notification: { title: string; body: string };
      webpush?: { fcmOptions: { link: string } };
    }) => {
      const failure = failures[message.token];
      if (failure !== undefined) return Promise.reject(fcmError(failure));

      sent.push({
        token: message.token,
        title: message.notification.title,
        body: message.notification.body,
        link: message.webpush?.fcmOptions.link,
      });

      return Promise.resolve('sent');
    },
  } as unknown as Messaging;
}

const event = anEvent('standup', '2026-08-22 10:00', ActiveLogic.TODAY);

interface Harness {
  service: FcmNotificationService;
  sent: SentMessage[];
  devices: FakeDevicesRepository;
}

/** A service wired to the named tokens, plus the two things worth asserting on. */
function harness(
  tokens: string[],
  options: { appUrl?: string; failures?: Record<string, string> } = {},
): Harness {
  const sent: SentMessage[] = [];
  const devices = new FakeDevicesRepository(tokens.map(aDevice));
  const service = new FcmNotificationService(
    devices,
    fakeMessaging(sent, options.failures),
    options.appUrl,
  );

  return { service, sent, devices };
}

describe('sending a due event', () => {
  it('reaches every device the owner registered', async () => {
    const { service, sent } = harness(['phone', 'laptop'], { appUrl: 'https://app.test/' });

    await service.notify(event);

    assert.deepEqual(sent.map((message) => message.token), ['phone', 'laptop']);
    assert.deepEqual(sent.map((message) => message.title), ['standup', 'standup']);
    assert.deepEqual(sent.map((message) => message.link), ['https://app.test/', 'https://app.test/']);
  });

  it('says nothing to a user who never turned notifications on', async () => {
    const { service, sent } = harness([]);

    await service.notify(event);

    assert.equal(sent.length, 0);
  });

  it('omits the click-through link when no app url is configured', async () => {
    const { service, sent } = harness(['phone']);

    await service.notify(event);

    assert.equal(sent[0]?.link, undefined);
  });
});

describe('what the alert says', () => {
  it('counts the steps still to do', async () => {
    const { service, sent } = harness(['phone']);

    await service.notify(anEvent('standup', '2026-08-22 10:00', ActiveLogic.TODAY, {
      subtasks: [
        { id: 'a', name: 'notes', status: TaskStatus.DONE },
        { id: 'b', name: 'agenda', status: TaskStatus.TODO },
      ],
    }));

    assert.equal(sent[0]?.body, 'Due now — 1 step left');
  });

  it('says only that it is due when there are no steps left', async () => {
    const { service, sent } = harness(['phone']);

    await service.notify(event);

    assert.equal(sent[0]?.body, 'Due now');
  });
});

describe('a token FCM refuses', () => {
  it('is deleted, and does not stop the other devices', async () => {
    const { service, sent, devices } = harness(['stale', 'laptop'], {
      failures: { stale: 'messaging/registration-token-not-registered' },
    });

    await service.notify(event);

    assert.deepEqual(devices.deleted, ['stale']);
    assert.deepEqual(sent.map((message) => message.token), ['laptop']);
  });

  // A network blip is our problem, not the token's: deleting the row would
  // cost the user every future notification over one bad minute.
  it('survives a transient failure without losing the registration', async () => {
    const { service, devices } = harness(['phone'], {
      failures: { phone: 'messaging/server-unavailable' },
    });

    await service.notify(event);

    assert.deepEqual(devices.deleted, []);
  });
});
