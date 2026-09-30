import { bootstrapApplication } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('bootstraps the application', async () => {
    document.body.innerHTML = '<app-root></app-root>';

    await expect(bootstrapApplication(App, appConfig)).resolves.toBeDefined();
  });
});
