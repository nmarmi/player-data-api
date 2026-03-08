const app = require('./app');

const PORT = process.env.PORT || 4001;

app.listen(PORT, () => {
  console.log(`Player Data API listening on http://localhost:${PORT}`);
  if (!process.env.API_LICENSE_KEY && !process.env.VALID_API_KEYS) {
    console.warn('Warning: No API_LICENSE_KEY or VALID_API_KEYS set. License checks will fail.');
  }
});
