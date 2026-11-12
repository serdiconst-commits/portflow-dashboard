import { normalizePortDateTime } from './exportReceiving.js';
// All holidays listed for Bayport / Barbours Cut, including reduced-hours holidays.
// Source: https://porthouston.com/toolbox/terminals/hours-and-schedules/
export const DEFAULT_PER_DIEM_CALENDAR = { '2026': ['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-11-27','2026-12-24','2026-12-25'] };
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function nextDay(day) { const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10); }
export function perDiemDeadline(outDate, calendar=DEFAULT_PER_DIEM_CALENDAR) {
  if (!validDay(outDate)) return {date:'',error:'Enter the port departure date.'};
  let day=outDate,count=0;
  for(let i=0;i<60;i++,day=nextDay(day)) {
    const year=day.slice(0,4);
    if (!Array.isArray(calendar[year])) return {date:'',error:`Add the ${year} holiday calendar before calculating the return date.`};
    const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday!==0 && weekday!==6 && !calendar[year].includes(day)) count++;
    if(count===4)return {date:day,error:''};
  }
  return {date:'',error:'Review the holiday calendar.'};
}
export function nextPerDiemWorkday(today, calendar) {
  let day=nextDay(today);
  for(let i=0;i<60;i++,day=nextDay(day)) {
    if(!Array.isArray(calendar[day.slice(0,4)]))return '';
    const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
    if(weekday!==0 && weekday!==6 && !calendar[day.slice(0,4)].includes(day))return day;
  }
  return '';
}
export function perDiemTracking(load, today, calendar=DEFAULT_PER_DIEM_CALENDAR) {
  if(load.loadType==='EXPORT' || !String(load.containerNumber || '').trim() || load.deletedAt) return {tracked:false};
  const matches = !load.perDiemContainerNumber || String(load.perDiemContainerNumber).trim().toUpperCase() === String(load.containerNumber).trim().toUpperCase();
  if(!matches || !validDay(load.perDiemPortOutDate))return {tracked:false};
  const calculation=perDiemDeadline(load.perDiemPortOutDate,calendar);
  const completed=['completed','delivered'].includes(String(load.status || '').trim().toLowerCase());
  const reopenedAt=Date.parse(load.perDiemReopenedAt || '');
  const reopened=Number.isFinite(reopenedAt);
  const finalReturn=(load.moves || []).some(move=>['RETURN','PICKUP_RETURN','YARD_RETURN'].includes(move.moveType) && move.status==='Completed' &&
    (!reopened || Date.parse(move.completedAt || '')>reopenedAt));
  const returned=completed || (!reopened && validDay(load.perDiemReturnedDate)) || finalReturn;
  const deadline=validDay(load.perDiemDueDate)?load.perDiemDueDate:calculation.date;
  let status=completed?'completed':returned?'returned':!deadline?'needs-calendar':deadline<today?'overdue':deadline===today?'today':deadline===nextPerDiemWorkday(today,calendar)?'soon':'upcoming';
  return {tracked:true,deadline,status,returned,error:deadline?'':calculation.error,source:load.perDiemOutSource || 'Manual'};
}
export function matchesPerDiemFilter(load,today,filter,calendar) {
  const state=perDiemTracking(load,today,calendar);
  if(!state.tracked || state.returned)return false;
  return filter==='all' || filter==='attention' && ['overdue','today','soon','needs-calendar'].includes(state.status) || state.status===filter;
}
export function houstonToday() { return normalizePortDateTime(new Date().toISOString()).slice(0,10); }
export function portOutDay(load,availability) {
  if(load.loadType==='EXPORT' || !availability?.found || !availability.containerNumber ||
    String(availability.containerNumber).trim().toUpperCase()!==String(load.containerNumber || '').trim().toUpperCase())return '';
  const day=normalizePortDateTime(availability.timeOut).slice(0,10);
  return validDay(day) && day<=houstonToday()?day:'';
}
