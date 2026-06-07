import express from 'express';
import documentsRouter from './routes/documents.routes.js';

const app = express();

// Add your production auth middleware before the scanner routes.
// app.use(authenticateDriver);
app.use('/api/documents', documentsRouter);

app.listen(process.env.PORT || 4000, () => {
  console.log(`Document scanner API listening on port ${process.env.PORT || 4000}`);
});

