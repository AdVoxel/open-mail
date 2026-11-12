// app.json, plus the sub-folder the web build is served from when it's
// deployed under a path (scripts/deploy-web.sh sets WEB_BASE_URL=/apps/mail).
// Without it (dev, desktop export) the app is served from the root.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.WEB_BASE_URL ? { baseUrl: process.env.WEB_BASE_URL } : {}),
  },
});
