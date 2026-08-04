import { getCompanyAnalyticsSettings } from './analyticsService.js';
import { assertDateRange } from './dbUtils.js';
import { callNvidiaChat, getNvidiaStatus } from './nvidiaService.js';
import { analyticsTools, pickAnalyticsTools } from '../tools/analyticsTools.js';
import { writeFinancialAudit } from './payrollService.js';

const aiRoles = new Set(['carrier', 'admin', 'administrator', 'owner', 'payroll']);

export const canUseAiAnalytics = (role) => aiRoles.has(String(role || '').trim().toLowerCase());

const systemPrompt = `You are PortFlow Business Assistant. Explain company analytics using only the structured data provided by PortFlow tools. Never invent financial values, loads, customers, drivers, invoices or payroll information. Clearly distinguish operational revenue, invoiced revenue and collected revenue. When data is missing, say that it is unavailable. Give concise, practical answers. Use the user's selected language. Do not expose sensitive personal data, authentication data, API keys or information belonging to another company.`;

export async function getAiBusinessStatus(db, companyId) {
  const settings = await getCompanyAnalyticsSettings(db, companyId);
  const nvidia = await getNvidiaStatus();
  return { companyEnabled: settings.allowAiAnalytics, ...nvidia };
}

export async function answerBusinessQuestion(db, context, input = {}) {
  if (!canUseAiAnalytics(context.role)) {
    const error = new Error('You do not have permission to use Ask PortFlow.');
    error.status = 403;
    throw error;
  }
  const settings = await getCompanyAnalyticsSettings(db, context.companyId);
  if (!settings.allowAiAnalytics) {
    const error = new Error('Allow AI Analytics is disabled for this company.');
    error.status = 403;
    throw error;
  }
  const question = String(input.question || '').trim().slice(0, 1000);
  if (!question) {
    const error = new Error('question is required.');
    error.status = 400;
    throw error;
  }
  const period = assertDateRange(input.period?.startDate, input.period?.endDate);
  const language = input.language === 'es' ? 'es' : 'en';
  const selected = pickAnalyticsTools(question);
  const toolResults = [];
  for (const name of selected) {
    const fn = analyticsTools[name];
    if (fn) toolResults.push(await fn(db, context, period));
  }
  const compactData = toolResults.map((result) => ({
    type: result.type,
    source: result.source,
    period: result.period,
    data: result.data,
    warnings: result.warnings,
  }));
  const answer = await callNvidiaChat({
    language,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ language, question, toolResults: compactData }) },
    ],
  });
  await writeFinancialAudit(db, context.companyId, context, 'AI_QUESTION_SUBMITTED', 'AI_ANALYTICS', '', {
    language,
    tools: selected,
  });
  return {
    answer,
    language,
    metricsUsed: selected,
    sources: compactData.map((item) => ({ type: item.type, period: `${item.period.startDate} to ${item.period.endDate}` })),
    warnings: compactData.flatMap((item) => item.warnings || []),
  };
}
