import OpenAI from 'openai';
import { DraftResult, GmailEmail } from './types.js';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export async function summarizeAndDraftReply(email: GmailEmail): Promise<DraftResult> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a concise business email assistant. Return valid JSON with keys summary and suggestedReply. Never promise actions that are not in the email. Keep the reply professional, brief, and ready to send.',
      },
      {
        role: 'user',
        content: [
          `From: ${email.from}`,
          `Subject: ${email.subject}`,
          '',
          'Email body:',
          email.body,
        ].join('\n'),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  const parsed = JSON.parse(content) as Partial<DraftResult>;
  return {
    summary: String(parsed.summary || '').trim(),
    suggestedReply: String(parsed.suggestedReply || '').trim(),
  };
}
