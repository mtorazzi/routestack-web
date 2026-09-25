import { Router } from 'express';

import { clearCredentials, loadConfig, maskConfig, saveConfig } from '../config.js';
import { testConnection } from '../routestack/verticals.js';
import { asyncHandler, sendOk } from './_helpers.js';

const router = Router();

/** Browser-safe config (secrets masked). */
router.get(
  '/config',
  asyncHandler((req, res) => {
    sendOk(res, maskConfig(loadConfig({ force: true })), { source: maskConfig(loadConfig()).source });
  }),
);

/** Save a config patch. Secret fields are only overwritten when non-empty. */
router.post(
  '/config',
  asyncHandler((req, res) => {
    saveConfig(req.body ?? {});
    sendOk(res, maskConfig(loadConfig()));
  }),
);

/** Remove stored credentials from the config file. */
router.delete(
  '/config',
  asyncHandler((req, res) => {
    clearCredentials();
    sendOk(res, maskConfig(loadConfig({ force: true })));
  }),
);

/** Live connectivity test: partner-token mint + tools/list. */
router.post(
  '/config/test',
  asyncHandler(async (req, res) => {
    const result = await testConnection();
    sendOk(res, result, { source: result.source });
  }),
);

export default router;
