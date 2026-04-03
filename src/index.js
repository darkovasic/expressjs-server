const express = require('express');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});