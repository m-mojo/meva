// Express factory — no server.listen here (that lives in server.js)
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');

const admsRouter = require('./device/adms');
const auth       = require('./middleware/auth');
const routes     = require('./routes');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.text({ type: 'text/plain' }));
  app.use(bodyParser.urlencoded({ extended: true }));

  // Static files
  app.use(express.static('public'));

  // ADMS device endpoints — no auth middleware; device cannot authenticate
  app.use(admsRouter);

  // All API routes — auth applied globally except public endpoints
  app.use('/api', (req, res, next) => {
    if (req.path === '/auth/login') return next(); // public
    auth(req, res, next);
  }, routes);

  return app;
}

module.exports = { createApp };
