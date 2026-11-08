import { dbGet,dbRun } from './dbUtils.js';
import { DEFAULT_PER_DIEM_CALENDAR, validDay, portOutDay, houstonToday } from '../../shared/perDiem.js';
export async function getPerDiemCalendar(db,companyId) {
  const company=await dbGet(db,'SELECT perDiemCalendarJson FROM companies WHERE id=?',[companyId]);
  let overrides={};try{overrides=JSON.parse(company?.perDiemCalendarJson || '{}');}catch{}
  return {...DEFAULT_PER_DIEM_CALENDAR,...overrides};
}
export async function capturePortOutDay(db,load,availability) {
  const day=portOutDay(load,availability);if(!day)return;
  await dbRun(db,`UPDATE loads SET perDiemPortOutDate=?,perDiemOutSource='Port Houston',perDiemContainerNumber=?
    WHERE id=? AND companyId=? AND UPPER(TRIM(containerNumber))=? AND COALESCE(perDiemPortOutDate,'')=''`,
  [day,String(load.containerNumber).trim().toUpperCase(),load.id,load.companyId,String(load.containerNumber).trim().toUpperCase()]);
}
export function mountPerDiemRoutes(app,{db,authenticate,requireRoles,dispatchLocationRoles,writeAuditLog}) {
  const auth=[authenticate,requireRoles(dispatchLocationRoles)];
  app.get('/api/per-diem/calendar',authenticate,async(req,res)=>{
    try{res.json(await getPerDiemCalendar(db,req.company.companyId));}catch(error){res.status(500).json({error:error.message});}
  });
  app.put('/api/per-diem/calendar',...auth,async(req,res)=>{
    const year=String(req.body?.year || '');const dates=req.body?.dates;
    if(!/^20\d{2}$/.test(year) || !Array.isArray(dates) || dates.length>366 || dates.some(day=>!validDay(day) || !day.startsWith(year+'-')))return res.status(400).json({error:'Enter valid holiday dates for the selected year.'});
    try{
      const row=await dbGet(db,'SELECT perDiemCalendarJson FROM companies WHERE id=?',[req.company.companyId]);
      let calendar={};try{calendar=JSON.parse(row?.perDiemCalendarJson || '{}');}catch{}
      calendar[year]=[...new Set(dates)].sort();
      const changed=await dbRun(db,"UPDATE companies SET perDiemCalendarJson=? WHERE id=? AND COALESCE(perDiemCalendarJson,'{}')=?",[JSON.stringify(calendar),req.company.companyId,row?.perDiemCalendarJson || '{}']);
      if(changed.changes!==1)return res.status(409).json({error:'The calendar changed. Refresh and try again.'});
      writeAuditLog(req,{action:'PER_DIEM_CALENDAR',entityType:'COMPANY',entityId:req.company.companyId,newValue:{year,dates:calendar[year]}});
      res.json(await getPerDiemCalendar(db,req.company.companyId));
    }catch(error){res.status(500).json({error:error.message});}
  });
  app.put('/api/loads/:id/per-diem',...auth,async(req,res)=>{
    const body=req.body || {};
    const out=String(body.portOutDate || '');const due=String(body.dueDate || '');const returned=String(body.returnedDate || '');
    if((out && !validDay(out)) || (due && !validDay(due)) || (returned && !validDay(returned)) || (!out && (due || returned)) || (due && due<out) || (returned && returned<out) || out>houstonToday() || returned>houstonToday())return res.status(400).json({error:'Enter valid departure and return dates. Return dates cannot precede departure.'});
    try{
      const load=await dbGet(db,'SELECT * FROM loads WHERE id=? AND companyId=?',[req.params.id,req.company.companyId]);
      if(!load || load.deletedAt)return res.status(404).json({error:'Load not found.'});
      if(load.loadType==='EXPORT' || !String(load.containerNumber || '').trim())return res.status(409).json({error:'Select an import / regular load with a container number.'});
      const source=out===load.perDiemPortOutDate && load.perDiemOutSource==='Port Houston'?'Port Houston':'Manual';
      const changed=await dbRun(db,`UPDATE loads SET perDiemPortOutDate=?,perDiemDueDate=?,perDiemReturnedDate=?,perDiemOutSource=?,perDiemContainerNumber=? WHERE id=? AND companyId=? AND UPPER(TRIM(containerNumber))=?`,[out,due,returned,out?source:'',out?String(load.containerNumber).trim().toUpperCase():'',load.id,req.company.companyId,String(load.containerNumber).trim().toUpperCase()]);
      if(changed.changes!==1)return res.status(409).json({error:'The container changed. Refresh the load and try again.'});
      const updated=await dbGet(db,'SELECT * FROM loads WHERE id=? AND companyId=?',[load.id,req.company.companyId]);
      const fields=['perDiemPortOutDate','perDiemDueDate','perDiemReturnedDate'];
      writeAuditLog(req,{action:'PER_DIEM_DATES',entityType:'LOAD',entityId:load.id,entityLabel:load.containerNumber,oldValue:Object.fromEntries(fields.map(key=>[key,load[key] || ''])),newValue:Object.fromEntries(fields.map(key=>[key,updated[key] || '']))});
      res.json(updated);
    }catch(error){res.status(500).json({error:error.message});}
  });
}
