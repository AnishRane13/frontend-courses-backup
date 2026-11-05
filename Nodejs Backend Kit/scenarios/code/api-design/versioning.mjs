// v1 and v2 side by side; v1 announces its end with Deprecation and Sunset.
import express from 'express';

const user = { id: 7, firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' };
const v1 = express.Router();
v1.get('/users/:id', (req, res) => res.json({ id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email }));
const v2 = express.Router();
v2.get('/users/:id', (req, res) => res.json({ id: user.id, name: { first: user.firstName, last: user.lastName }, email: user.email }));

export function versionedApp({ deprecationFirst = true } = {}) {
  const app = express();
  const deprecate = (req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Wed, 30 Jun 2027 23:59:59 GMT');
    res.set('Link', '</v2/users>; rel="successor-version"');
    next();
  };
  if (deprecationFirst) app.use('/v1', deprecate, v1);
  else { app.use('/v1', v1); app.use('/v1', deprecate); } // wrong order: v1 answers first
  app.use('/v2', v2);
  return app;
}
