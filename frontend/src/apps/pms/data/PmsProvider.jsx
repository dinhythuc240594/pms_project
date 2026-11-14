import React, { useCallback, useEffect, useRef, useState } from 'react';
import { availableRooms, today, addDays, roomIsBlocked } from './model';
import { PmsContext } from './usePms';
import { FEATURES, routePolicy } from './access';
import { createApiClient, createRequestScope, createIntentJournal, permitted, subscriptionDecision, tenantRole, systemUser } from './api';
import { useDraftGuard, useDraftNavigation } from '../../../shared/drafts/DraftGuardProvider.jsx';
import { requestTenantSelection } from './tenantNavigation.js';
import { dateRangeParams } from '../../../shared/lib/dateRangeQuery.js';
import { isFeatureVisible } from '../../../shared/config/featureVisibility.js';
const browserIntentStorage = () => { try { return sessionStorage; } catch { return undefined; } };
const TENANT_KEY = 'bluejay-pms-active-tenant-v2';
const catalogs = ['roomTypes','bookingSources','services','serviceCategories','paymentMethods','funds','warehouses','items','itemCategories','suppliers','units','bedTypes','cashbookCategories','meals','commissionTypes','commissionRules'];
const emptyState = () => ({ rooms: [], bookings: [], guests: [], receipts: [], posInvoices: [], cashDocuments: [], cashbookActors: [], housekeepingAccounts: [], housekeepingStaff: [], housekeepingShifts: [], housekeepingTasks: [], housekeepingWorkLogs: [], housekeepingLog: [], ledger: [], rates: [], roomBlocks: [], users: [], settings: { timezone:'Asia/Ho_Chi_Minh',currency:'VND',checkInTime:'14:00',checkOutTime:'12:00' }, masters:Object.fromEntries(catalogs.map(key=>[key,[]])) });
const unavailable = () => { throw new Error('Chức năng này chưa được triển khai. Dữ liệu chưa được lưu.'); };
const enc=encodeURIComponent;
function olderBookingSnapshot(existing, incoming) {
  if (Number(existing.version) > Number(incoming.version)) return true;
  // A replay can have the same booking version but predate append-only money and notes.
  if (['payments','charges','notes','history'].some(field => (existing[field] || []).some(row => !incoming[field]?.some(next => next.id === row.id)))) return true;
  return (existing.payments || []).some(payment => (payment.refunds || []).some(refund => !incoming.payments?.find(next => next.id === payment.id)?.refunds?.some(next => next.id === refund.id)));
}
export function PmsProvider({ children }) {
  const [pendingRequests, setPendingRequests] = useState({ reads: 0, writes: 0 });
  const pendingWrites = useRef(0);
  const activeSession = useRef(false);
  const activeRole = useRef(null);
  const [api] = useState(() => createApiClient(undefined, undefined, value => { pendingWrites.current = value.writes; setPendingRequests(value); }));
  const { requestLeave, clearDrafts } = useDraftNavigation();
  useDraftGuard({ persistent: true, dirty: false, pending: () => activeSession.current && pendingWrites.current > 0 });
  const scope = useRef(createRequestScope()).current, intents=useRef(createIntentJournal(browserIntentStorage())).current;
  const [session,setSession] = useState(null);
  const [authGeneration,setAuthGeneration] = useState(0);
  const [selectedId,setSelectedId] = useState(()=>{ try{return JSON.parse(localStorage.getItem(TENANT_KEY));}catch{return null;} });
  const [state,setState] = useState(emptyState), [loading,setLoading] = useState(true), [workspaceLoading,setWorkspaceLoading] = useState(false);
  const [workspaceRevision,setWorkspaceRevision] = useState(0), [lastSyncedAt,setLastSyncedAt] = useState(null), [workspaceSyncError,setWorkspaceSyncError] = useState('');
  const [writeReceipt,setWriteReceipt] = useState(null);
  const [loadError,setLoadError] = useState(''), [loadErrorStatus,setLoadErrorStatus] = useState(null), [accessDialog,setAccessDialog] = useState(null), [allTenants,setAllTenants] = useState([]), [auditLogs,setAuditLogs] = useState([]);
  const [adminLoadError,setAdminLoadError] = useState(null);
  const fetchVersion = useRef(0), authVersion = useRef(0), identityVersion = useRef(0), writeVersion = useRef(0), actorId = useRef('');
  const user=session?.user||null, hotels=(session?.tenants||[]).filter(t=>tenantRole(user,t.id));
  const tenantId=hotels.some(t=>t.id===selectedId)?selectedId:hotels[0]?.id||null;
  const sessionTenantStatus=hotels.find(t=>t.id===tenantId)?.status;
  const tenant=state.tenant?.id===tenantId ? {...hotels.find(t=>t.id===tenantId),...state.tenant} : hotels.find(t=>t.id===tenantId), role=tenantRole(user,tenantId);
  const forgetSession=useCallback(()=>{ ++authVersion.current;actorId.current=''; activeSession.current=false; clearDrafts(); setAuthGeneration(value=>value+1); api.setCsrf(null);scope.select(null);++fetchVersion.current;setSession(null);setState(emptyState());setAllTenants([]);setAuditLogs([]);setLoadError('');setLoadErrorStatus(null);setAdminLoadError(null);setAccessDialog(null);setWorkspaceSyncError('');setLastSyncedAt(null);setWriteReceipt(null); },[api,scope,clearDrafts]);
  function acceptSession(next){
    ++authVersion.current;actorId.current=next.user.id; clearDrafts(); activeSession.current=true; setAuthGeneration(value=>value+1); api.setCsrf(next.csrfToken);setSession(next);setAllTenants([]);setAuditLogs([]);setLoadError('');setLoadErrorStatus(null);setAdminLoadError(null);setAccessDialog(null);setWriteReceipt(null);
    const chosen=next.tenants.find(t=>t.id===selectedId&&tenantRole(next.user,t.id))||next.tenants.find(t=>tenantRole(next.user,t.id));
    activeRole.current=tenantRole(next.user,chosen?.id);scope.select(chosen?.id||null);setSelectedId(chosen?.id||null);setState(emptyState());return next.user;
  }
  async function restoreSession(){let version=++authVersion.current;setLoading(true);try{const next=await api.request('/api/auth/session');if(version!==authVersion.current)return;acceptSession(next);version=authVersion.current;}catch(error){if(version!==authVersion.current)return;forgetSession();version=authVersion.current;if(error.status!==401){setLoadError(error.message);setLoadErrorStatus(error.status||503);}}finally{if(version===authVersion.current)setLoading(false);}}
  useEffect(()=>{restoreSession();},[]);
  const revokeTenant=useCallback(id=>{
    ++identityVersion.current;
    if(scope.current().tenantId===id){scope.select(null);++fetchVersion.current;clearDrafts();setState(emptyState());setWorkspaceLoading(false);}
    setSession(current=>current?{...current,user:{...current.user,memberships:current.user.memberships.filter(membership=>membership.tenantId!==id)},tenants:current.tenants.filter(hotel=>hotel.id!==id)}:current);
  },[scope,clearDrafts]);
  const fail=useCallback(error=>{if(error.status===401)forgetSession();setAccessDialog({reason:error.code==='csrf_failed'?'csrf':error.status===403?'role':'error',message:error.message,status:error.status||503,code:error.code});throw error;},[forgetSession]);
  const refresh=useCallback(async(token=scope.current(),initial=false,quiet=false,canApply,preserveState=false)=>{
    if(!token.tenantId||!scope.isCurrent(token))return false;
    const version=++fetchVersion.current;if(initial)setWorkspaceLoading(true);
    // A read that started before a write was acknowledged cannot reconcile that write.
    const acknowledged=intents.acknowledged('/api/tenants/'+enc(token.tenantId)+'/',actorId.current);
    const receiptVersion=writeVersion.current;
    try{
      const data=await api.request('/api/tenants/'+encodeURIComponent(token.tenantId)+'/workspace',{quiet});
      if(!scope.isCurrent(token)||version!==fetchVersion.current||(quiet&&canApply&&!canApply()))return false;
      setState({...emptyState(),...data,settings:{...emptyState().settings,...data.settings},masters:{...emptyState().masters,...data.masters},housekeepingLog:data.housekeepingLogs||data.housekeepingLog||[]});setLoadError('');setLoadErrorStatus(null);
      acknowledged.forEach(intent=>intents.confirm(intent));
      setWriteReceipt(previous=>previous?.tenantId===token.tenantId&&previous.generation<=receiptVersion?{...previous,synchronized:true}:previous);
      setWorkspaceRevision(value=>value+1);setLastSyncedAt(new Date().toISOString());setWorkspaceSyncError('');
      return true;
    }catch(error){if(scope.isCurrent(token)&&version===fetchVersion.current){if((preserveState&&![401,403,404].includes(error.status))||(quiet&&![401,403,404].includes(error.status)))setWorkspaceSyncError(error.message);else{setLoadError(error.message);setLoadErrorStatus(error.status||503);setState(emptyState());if([401,403,404].includes(error.status))clearDrafts();}if(error.status===401)forgetSession();else if(error.code==='tenant_denied')revokeTenant(token.tenantId);}throw error;}
    finally{if(scope.isCurrent(token)&&version===fetchVersion.current)setWorkspaceLoading(false);}
  },[api,scope,intents,forgetSession,clearDrafts,revokeTenant]);
  const refreshWorkspace=useCallback(({quiet=false,canApply}={})=>refresh(scope.current(),false,quiet,canApply,true),[refresh,scope]);
  useEffect(()=>{if(scope.current().tenantId!==tenantId||activeRole.current!==role)clearDrafts();activeRole.current=role;const token=scope.select(tenantId);setState(emptyState());setWorkspaceLoading(false);setLoadError('');setLoadErrorStatus(null);setWorkspaceSyncError('');setLastSyncedAt(null);const saved=intents.acknowledged('/api/tenants/'+enc(tenantId)+'/',actorId.current).at(-1);setWriteReceipt(saved?{id:saved.resultId,intent:saved.key,tenantId,synchronized:false,generation:++writeVersion.current}:null);if(user)refresh(token,true).catch(()=>{});},[tenantId,user?.id,role,sessionTenantStatus]);
  async function loadAdmin(){
    if(!systemUser(user))return;
    const version=authVersion.current;
    try{const result=await api.request('/api/tenants');if(version!==authVersion.current)return;setAllTenants(result.tenants||[]);if(user.globalRole==='SUPER_ADMIN'){const logs=await api.request('/api/audit');if(version===authVersion.current)setAuditLogs(logs.auditLogs||logs.logs||[]);}if(version===authVersion.current)setAdminLoadError(null);}
    catch(error){if(version===authVersion.current){if(error.status===401)forgetSession();else setAdminLoadError({message:error.message,status:error.status||503});}throw error;}
  }
  useEffect(()=>{loadAdmin().catch(()=>{});},[user?.id]);
  async function retryData(){if(!user)return restoreSession();if(scope.current().tenantId)await refresh();if(systemUser(user))await loadAdmin();}
  async function login(email,password,remember=false){let version=++authVersion.current;try{const next=await api.request('/api/auth/login',{method:'POST',body:{email,password,remember}});if(version!==authVersion.current)throw new Error('Phiên đăng nhập đã thay đổi.');const result=acceptSession(next);version=authVersion.current;return result;}finally{if(version===authVersion.current)setLoading(false);}}
  async function logout(){const version=++authVersion.current;try{await api.request('/api/auth/logout',{method:'POST',body:{}});if(version===authVersion.current)forgetSession();}catch(error){if(version===authVersion.current)return fail(error);throw error;}}
  function selectTenant(id){
    return requestTenantSelection({id,tenantId,hotels,scope,requestLeave,clearDrafts,fail,apply:nextId=>{
      ++fetchVersion.current;setState(emptyState());setWorkspaceLoading(true);setSelectedId(nextId);setAccessDialog(null);setLoadError('');setLoadErrorStatus(null);setWorkspaceSyncError('');setLastSyncedAt(null);
      try{localStorage.setItem(TENANT_KEY,JSON.stringify(nextId));}catch{/* Selection remains in memory. */}
    }});
  }
  async function mutate(path,body,method='POST',intent){
    const token=scope.current();if(!token.tenantId)return fail(new Error('Chưa chọn khách sạn.'));
    const version=authVersion.current;
    let pendingIntent,result;
    try{
      const fullPath='/api/tenants/'+enc(token.tenantId)+path;
      if(intent)pendingIntent=await intents.acquire(fullPath,body,intent,actorId.current);
      if(!scope.isCurrent(token)||version!==authVersion.current)throw new Error('Phiên thao tác đã thay đổi. Vui lòng tải lại dữ liệu.');
      ++fetchVersion.current;
      result=await api.request(fullPath,{method,body,intent:pendingIntent?.key});
    }catch(error){if(['stale_booking','stale_guest'].includes(error.code))throw error;if(scope.isCurrent(token)&&version===authVersion.current){if(error.code==='tenant_denied')revokeTenant(token.tenantId);return fail(error);}throw error;}
    if(pendingIntent)intents.acknowledge(pendingIntent,result?.id);
    if(!scope.isCurrent(token)||version!==authVersion.current)return result;
    const receipt={id:result?.id||null,intent:pendingIntent?.key||null,tenantId:token.tenantId,synchronized:false,generation:++writeVersion.current};
    setWriteReceipt(receipt);
    if(/^\/reservations(?:\/|$)/.test(path)&&result?.id&&Array.isArray(result.rooms)){
      setState(previous=>{
        if(!scope.isCurrent(token)||version!==authVersion.current)return previous;
        const existing=previous.bookings.find(booking=>booking.id===result.id);
        if(existing&&olderBookingSnapshot(existing,result))return previous;
        return {...previous,bookings:existing?previous.bookings.map(booking=>booking.id===result.id?result:booking):[...previous.bookings,result]};
      });
    }
    try{
      await refresh(token,false,true,undefined,true);
    }catch{/* refresh records its own synchronization error; the write remains successful. */}
    return result;
  }
  const requestTenant=useCallback(async(path,options)=>{const token=scope.current();try{if(!token.tenantId)throw new Error('Chưa chọn khách sạn.');const data=await api.request('/api/tenants/'+encodeURIComponent(token.tenantId)+path,options);if(!scope.isCurrent(token))throw new Error('Khách sạn đã thay đổi.');return data;}catch(error){if(scope.isCurrent(token)&&[401,403].includes(error.status)){if(error.code==='tenant_denied')revokeTenant(token.tenantId);return fail(error);}throw error;}},[api,scope,fail,revokeTenant,tenantId,user?.id]);
  const access=(action,feature,write=!action.endsWith('.view'))=>{
    const result=permitted(user,tenant,action,write);
    return result.allowed ? subscriptionDecision(state.subscription,state.features,action,feature,write) : result;
  };
  function routeAccess(path){
    const policy=routePolicy(path);
    if(policy.manager){
      if(!user)return{allowed:false,reason:'session',message:'Vui lòng đăng nhập.'};
      if(!systemUser(user)||(policy.superOnly&&user.globalRole!=='SUPER_ADMIN'))return{allowed:false,reason:'role',message:'Bạn không có quyền quản trị phần này (403).'};
      return{allowed:true};
    }
    return access(policy.action,policy.feature,false);
  }
  function allowAction(action){if(/^ota\./.test(action)){setAccessDialog({reason:'unavailable',message:'Chức năng này chưa được triển khai.'});return false;}const result=access(action,undefined,true);if(!result.allowed)setAccessDialog(result);return result.allowed;}
  async function runAction(action,feature,callback){if(!allowAction(action))return;try{await callback();}catch(error){setAccessDialog({reason:'error',message:error.message});}}
  const available=(start=today(state.settings.timezone),end=addDays(start,1),typeId='')=>availableRooms(state.rooms.filter(r=>r.active!==false && state.masters.roomTypes.some(t=>t.id===r.typeId&&t.active!==false)),state.bookings,start,end,typeId).filter(r => !roomIsBlocked(r,state.roomBlocks,start,end) && !state.rates.some(rate => rate.roomTypeId === r.typeId && rate.date >= start && rate.date < end && rate.stopSell));
  const refreshIdentity=useCallback(async()=>{
    const version=authVersion.current, identity=++identityVersion.current;
    try{const next=await api.request('/api/auth/session',{quiet:true});if(version===authVersion.current&&identity===identityVersion.current){api.setCsrf(next.csrfToken);setSession(next);}}
    catch(error){if(version===authVersion.current&&identity===identityVersion.current){if([401,403].includes(error.status))return fail(error);setWorkspaceSyncError(error.message);}throw error;}
  },[api,fail]);
  useEffect(()=>{
    if(!user)return;
    const revalidate=()=>{refreshIdentity().catch(()=>{});};
    const onVisible=()=>{if(document.visibilityState==='visible')revalidate();};
    const timer=setInterval(revalidate,30000);
    window.addEventListener('focus',revalidate);document.addEventListener('visibilitychange',onVisible);
    return()=>{clearInterval(timer);window.removeEventListener('focus',revalidate);document.removeEventListener('visibilitychange',onVisible);};
  },[user?.id,refreshIdentity]);
  async function saveTenant({id,...input}){
    const version=authVersion.current;let result;
    try{result=await api.request('/api/tenants'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:input});}
    catch(error){if(version===authVersion.current)return fail(error);throw error;}
    if(version===authVersion.current){setAllTenants(rows=>id?rows.map(row=>row.id===id?result:row):[...rows,result]);await refreshIdentity().catch(()=>{});}
    return result;
  }
  const mutateWithIntent=(path,input,method='POST',intent)=>mutate(path,input,method,intent||crypto.randomUUID());
  const requestSystem=useCallback(async(path,options)=>{const version=authVersion.current;try{const result=await api.request(path,options);if(version!==authVersion.current)throw new Error('Phiên đăng nhập đã thay đổi.');return result;}catch(error){if(version===authVersion.current&&[401,403].includes(error.status))return fail(error);throw error;}},[api,fail]);
  const requestManagedTenant=useCallback((id,path,options)=>requestSystem('/api/admin/channex/tenants/'+enc(id)+path,options),[requestSystem]);
  const listSaasInvoices=useCallback(filters=>requestSystem('/api/billing/invoices?'+dateRangeParams(filters)),[requestSystem]);
  const getOwnBilling=useCallback(()=>requestTenant('/billing'),[requestTenant]);
  const listOwnBillingInvoices=useCallback((page=1,pageSize=10)=>requestTenant('/billing/invoices?'+new URLSearchParams({page,pageSize})),[requestTenant]);
  const getOwnBillingInvoice=useCallback(id=>requestTenant('/billing/invoices/'+enc(id)),[requestTenant]);
  const listOwnBillingHistory=useCallback((page=1,pageSize=10)=>requestTenant('/billing/history?'+new URLSearchParams({page,pageSize})),[requestTenant]);
  const postSaasMoney=useCallback(async(path,input,intent)=>{
    const version=authVersion.current;
    const pending=await intents.acquire(path,input,intent,user?.id);
    if(version!==authVersion.current)throw new Error('Phiên đăng nhập đã thay đổi.');
    const result=await requestSystem(path,{method:'POST',body:input,intent:pending.key});
    intents.confirm(pending);return result;
  },[requestSystem,intents,user?.id]);
  const createSaasInvoice=useCallback((input,intent)=>postSaasMoney('/api/billing/invoices',input,intent),[postSaasMoney]);
  const recordSaasPayment=useCallback((id,input,intent)=>postSaasMoney('/api/billing/invoices/'+enc(id)+'/payments',input,intent),[postSaasMoney]);
  const refundSaasPayment=useCallback((id,paymentId,input,intent)=>postSaasMoney('/api/billing/invoices/'+enc(id)+'/payments/'+enc(paymentId)+'/refund',input,intent),[postSaasMoney]);
  const getOperationalAccess=useCallback(id=>requestSystem('/api/billing/tenants/'+enc(id)+'/operational-access'),[requestSystem]);
  const saveOperationalAccess=useCallback((id,input,intent)=>postSaasMoney('/api/billing/tenants/'+enc(id)+'/operational-access',input,intent),[postSaasMoney]);
  const voidSaasInvoice=useCallback((id,reason)=>requestSystem('/api/billing/invoices/'+enc(id)+'/void',{method:'POST',body:{reason}}),[requestSystem]);
  const getManagerOverview=useCallback((start,end)=>requestSystem('/api/manager/overview?'+dateRangeParams({start,end})),[requestSystem]);
  const getManagerChannels=useCallback(()=>requestSystem('/api/admin/channex'),[requestSystem]);
  const getChannexAccounts=useCallback(()=>requestSystem('/api/admin/channex/accounts'),[requestSystem]);
  const getChannexProperties=useCallback((accountId,page=1)=>requestSystem('/api/admin/channex/properties?'+new URLSearchParams({accountId,page})),[requestSystem]);
  const createChannexProperty=useCallback(input=>requestSystem('/api/admin/channex/properties',{method:'POST',body:input}),[requestSystem]);
  const getChannexCatalog=useCallback((accountId,propertyId)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/catalog?'+new URLSearchParams({accountId})),[requestSystem]);
  const getChannexBookings=useCallback((accountId,propertyId,page=1)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/bookings?'+new URLSearchParams({accountId,page})),[requestSystem]);
  const getChannexInventory=useCallback((accountId,propertyId,start,end)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/inventory?'+dateRangeParams({accountId,start,end})),[requestSystem]);
  const getChannexRemoteChannels=useCallback((accountId,propertyId,page=1)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels?'+new URLSearchParams({accountId,page})),[requestSystem]);
  const getChannexChannelAdapters=useCallback((accountId,propertyId)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channel-adapters?'+new URLSearchParams({accountId})),[requestSystem]);
  const getChannexChannel=useCallback((accountId,propertyId,channelId)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels/'+enc(channelId)+'?'+new URLSearchParams({accountId})),[requestSystem]);
  const probeChannexChannel=useCallback((accountId,propertyId,action,input)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channel-probe/'+enc(action),{method:'POST',body:{...input,accountId}}),[requestSystem]);
  const saveChannexChannel=useCallback((accountId,propertyId,{id,...input})=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:{...input,accountId}}),[requestSystem]);
  const actionChannexChannel=useCallback((accountId,propertyId,channelId,action,input)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels/'+enc(channelId)+(action==='delete'?'':'/'+enc(action)),{method:action==='delete'?'DELETE':'POST',body:{...input,accountId}}),[requestSystem]);
  const createChannexAirbnbLink=useCallback((accountId,propertyId,input)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/airbnb/connection-link',{method:'POST',body:{...input,accountId}}),[requestSystem]);
  const confirmChannexAirbnb=useCallback(input=>requestSystem('/api/admin/channex/airbnb/confirm',{method:'POST',body:input}),[requestSystem]);
  const getChannexAirbnbListings=useCallback((accountId,propertyId,channelId)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels/'+enc(channelId)+'/airbnb/listings?'+new URLSearchParams({accountId})),[requestSystem]);
  const saveChannexAirbnbMapping=useCallback((accountId,propertyId,channelId,input)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels/'+enc(channelId)+'/airbnb/mappings',{method:'POST',body:{...input,accountId}}),[requestSystem]);
  const deleteChannexAirbnbMapping=useCallback((accountId,propertyId,channelId,mappingId,input)=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/channels/'+enc(channelId)+'/airbnb/mappings/'+enc(mappingId),{method:'DELETE',body:{...input,accountId}}),[requestSystem]);
  const saveChannexRoomType=useCallback((accountId,propertyId,{id,...input})=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/room-types'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:{...input,accountId}}),[requestSystem]);
  const saveChannexRatePlan=useCallback((accountId,propertyId,{id,...input})=>requestSystem('/api/admin/channex/properties/'+enc(propertyId)+'/rate-plans'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:{...input,accountId}}),[requestSystem]);
  const getCustomerHistory=useCallback((id,page=1)=>requestSystem('/api/tenants/'+enc(id)+'/customer-history?'+new URLSearchParams({page,pageSize:20})),[requestSystem]);
  const searchCustomerAccounts=useCallback(search=>requestSystem('/api/admin/customer-accounts?'+new URLSearchParams({search})),[requestSystem]);
  const listCustomerAccounts=useCallback((filters={})=>{
    const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==undefined&&value!==null&&value!==''));
    return requestSystem('/api/admin/customer-accounts/directory?'+params);
  },[requestSystem]);
  const getOwnSessions=useCallback(()=>requestSystem('/api/auth/sessions'),[requestSystem]);
  const revokeOtherSessions=useCallback(()=>requestSystem('/api/auth/sessions/revoke-others',{method:'POST',body:{}}),[requestSystem]);
  const saveOwnProfile=useCallback(async name=>{const result=await requestSystem('/api/auth/profile',{method:'PATCH',body:{name}});setSession(previous=>previous?{...previous,user:result.user}:previous);return result;},[requestSystem]);
  const listPlans=useCallback(()=>requestSystem('/api/plans'),[requestSystem]);
  const listSystemUsers=useCallback(()=>requestSystem('/api/users'),[requestSystem]);
  const saveSystemUser=useCallback(async({id,...input})=>{const result=await requestSystem('/api/users'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:input});if(result.id===user?.id)await refreshIdentity().catch(()=>{});return result;},[requestSystem,refreshIdentity,user]);
  const getManagerFeatures=useCallback(()=>requestSystem('/api/features'),[requestSystem]);
  const setGlobalFeature=useCallback(async(code,enabledGlobal)=>{const result=await requestSystem('/api/features/'+enc(code),{method:'PATCH',body:{enabledGlobal}});if(scope.current().tenantId)await refresh().catch(()=>{});return result;},[requestSystem,scope,refresh]);
  const saveFeatureOverride=useCallback(async(id,code,input)=>{const result=await requestSystem('/api/tenants/'+enc(id)+'/feature-overrides/'+enc(code),{method:'PUT',body:input});if(scope.current().tenantId===id)await refresh().catch(()=>{});return result;},[requestSystem,scope,refresh]);
  const removeFeatureOverride=useCallback(async(id,code)=>{const result=await requestSystem('/api/tenants/'+enc(id)+'/feature-overrides/'+enc(code),{method:'DELETE'});if(scope.current().tenantId===id)await refresh().catch(()=>{});return result;},[requestSystem,scope,refresh]);
  const getTenantSubscription=useCallback(id=>requestSystem('/api/tenants/'+enc(id)+'/subscription'),[requestSystem]);
  const getSubscriptionHistory=useCallback(id=>requestSystem('/api/tenants/'+enc(id)+'/subscription/history'),[requestSystem]);
  const savePlan=useCallback(async({id,...input})=>{const result=await requestSystem('/api/plans'+(id?'/'+enc(id):''),{method:id?'PATCH':'POST',body:input});if(scope.current().tenantId)await refresh(scope.current(),false,true).catch(()=>{});return result;},[requestSystem,refresh,scope]);
  const deletePlan=useCallback(id=>requestSystem('/api/plans/'+enc(id),{method:'DELETE'}),[requestSystem]);
  const saveTenantSubscription=useCallback(async(id,input)=>{const result=await requestSystem('/api/tenants/'+enc(id)+'/subscription',{method:'PUT',body:input});if(scope.current().tenantId===id)await refresh(scope.current(),false,true).catch(()=>{});return result;},[requestSystem,refresh,scope]);
  const getDashboardReport=useCallback(date=>requestTenant('/reports/dashboard?date='+enc(date)),[requestTenant]);
  const getRevenueReport=useCallback((start,end,currency,basis='original')=>requestTenant('/reports/revenue?'+dateRangeParams({start,end,currency,basis})),[requestTenant]);
  const getFinancialReport=useCallback((start,end,currency,basis='original')=>requestTenant('/reports/financial?'+dateRangeParams({start,end,currency,basis})),[requestTenant]);
  const getBusinessReport=useCallback((report,start,end,currency,basis='original')=>requestTenant('/reports/business?'+dateRangeParams({report,start,end,currency,basis})),[requestTenant]);
  const getCommissions=useCallback(filters=>requestTenant('/commissions?'+dateRangeParams(filters,{startKey:'startDate',endKey:'endDate'})),[requestTenant]);
  const features=Object.entries(state.features||{}).filter(([code])=>isFeatureVisible(code)).map(([code,enabled])=>({...FEATURES.find(item=>item.code===code),id:code,code,name:FEATURES.find(item=>item.code===code)?.name||code,enabledGlobal:enabled,allowed:enabled}));
  const value={
    ...state,...state.masters,loading,workspaceLoading:workspaceLoading||Boolean(user&&tenantId&&state.tenant?.id!==tenantId&&!loadError),pendingRequests,workspaceRevision,lastSyncedAt,workspaceSyncError,writeReceipt,refreshWorkspace,loadError:loadError||adminLoadError?.message||'',loadErrorStatus:loadError?loadErrorStatus:adminLoadError?.status||null,retry:retryData,tenant,tenantId,hotels,tenants:systemUser(user)?allTenants:hotels,user,role,isManager:systemUser(user),authGeneration,
    workspace:{tenants:allTenants.length?allTenants:hotels,users:state.users,auditLogs,features,tenantFeatureOverrides:{}},
    login,logout,selectTenant,access,routeAccess,settingsPath:routeAccess('/id/settings').allowed?'/id/settings':'/id/settings?section=channels',allowAction,runAction,accessDialog,showAccess:setAccessDialog,closeAccess:()=>setAccessDialog(null),
    quota:state.quota||{rooms:{used:state.rooms.length,limit:null},users:{used:state.users.length,limit:null}},subscription:state.subscription||null,storageWarning:'',features,tenantFeatureOverrides:{},
    createBooking:(input,intent)=>mutateWithIntent('/reservations',input,'POST',intent),updateBooking:(id,input,intent)=>mutateWithIntent('/reservations/'+enc(id),input,'PATCH',intent),
    previewStayChange:(id,input)=>requestTenant('/reservations/'+enc(id)+'/stay-change/preview',{method:'POST',body:input,readOnly:true}),
    confirmStayChange:(id,input,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/stay-change',input,'POST',intent),
    changeStatus:(id,status,expectedVersion,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/status',{status,expectedVersion},'POST',intent),
    cleanRoom:id=>mutate('/rooms/'+enc(id)+'/condition',{condition:'clean'}),dirtyRoom:id=>mutate('/rooms/'+enc(id)+'/condition',{condition:'dirty'}),setCondition:(id,condition)=>mutate('/rooms/'+enc(id)+'/condition',{condition}),
    saveMaster:(catalog,input)=>mutate('/masters/'+enc(catalog),input,input.id?'PATCH':'POST'),toggleMaster:(catalog,id)=>mutate('/masters/'+enc(catalog)+'/'+enc(id)+'/toggle',{}),
    saveSettings:input=>mutate('/settings',input,'PATCH'),saveTenantUser:async input=>{const version=authVersion.current;const result=await mutate('/users'+(input.id?'/'+enc(input.id):''),input.id ? {role:input.role,active:input.active} : input.existingAccount ? {email:input.email,role:input.role,active:input.active} : {name:input.name,email:input.email,password:input.password,role:input.role,active:input.active},input.id?'PATCH':'POST');if(version===authVersion.current)await refreshIdentity().catch(()=>{});return result;},
    getCommissions,settleCommission:input=>mutate('/commissions/settle',input),payCommission:(id,input,intent)=>mutateWithIntent('/commissions/'+enc(id)+'/payments',input,'POST',intent),
    getCommissionReview:id=>requestTenant('/commissions/'+enc(id)+'/review'),
    reviewCommission:(id,input,intent)=>mutateWithIntent('/commissions/'+enc(id)+'/review',input,'POST',intent),
    recoverCommission:(id,input,intent)=>mutateWithIntent('/commissions/'+enc(id)+'/recoveries',input,'POST',intent),
    resolveChannelReview:(id,input,intent)=>mutateWithIntent('/channels/booking-reviews/'+enc(id)+'/resolve',input,'POST',intent),
    channelIncidentAction:(id,input,intent)=>mutateWithIntent('/channels/incidents/'+enc(id)+'/actions',input,'POST',intent),
    addCharge:(id,input,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/charges',input,'POST',intent),addPayment:(id,input,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/payments',input,'POST',intent),refundPayment:(id,paymentId,input,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/payments/'+enc(paymentId)+'/refund',input,'POST',intent),addNote:(id,input,intent)=>mutateWithIntent('/reservations/'+enc(id)+'/notes',input,'POST',intent),
    savePosInvoice:({id,...input})=>mutateWithIntent('/pos/invoices'+(id?'/'+enc(id):''),input,id?'PATCH':'POST'),
    getPosInvoices:filters=>requestTenant('/pos/invoices?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''&&v!=null))),
    getPosInvoice:id=>requestTenant('/pos/invoices/'+enc(id)),
    postPosInvoice:(id,input={})=>mutateWithIntent('/pos/invoices/'+enc(id)+'/post',input),
    payPosInvoice:(id,input)=>mutateWithIntent('/pos/invoices/'+enc(id)+'/payments',input),
    refundPosInvoice:(id,paymentId,input)=>mutateWithIntent('/pos/invoices/'+enc(id)+'/payments/'+enc(paymentId)+'/refund',input),
    cancelPosInvoice:(id,input)=>mutateWithIntent('/pos/invoices/'+enc(id)+'/cancel',input),
    getCashbook:filters=>requestTenant('/cashbook?'+dateRangeParams(filters,{startKey:'startDate',endKey:'endDate'})),
    createCashDocument:input=>mutateWithIntent('/cash-documents',input),reverseCashDocument:(id,input)=>mutateWithIntent('/cash-documents/'+enc(id)+'/reverse',input),
    adjustBooking:(id,input)=>mutateWithIntent('/reservations/'+enc(id)+'/adjustments',input),
    saveHousekeepingStaff:({id,...input})=>mutate('/housekeeping/staff'+(id?'/'+enc(id):''),input,id?'PATCH':'POST'),
    saveHousekeepingShift:({id,...input})=>mutate('/housekeeping/shifts'+(id?'/'+enc(id):''),input,id?'PATCH':'POST'),
    generateHousekeepingPlan:input=>mutate('/housekeeping/tasks',input),
    createHousekeepingTask:input=>mutate('/housekeeping/tasks/manual',input),
    assignHousekeepingTask:(id,input)=>mutate('/housekeeping/tasks/'+enc(id)+'/assign',input),
    updateHousekeepingTask:(id,input)=>mutate('/housekeeping/tasks/'+enc(id)+'/status',input),
    quote:input=>requestTenant('/quote',{method:'POST',body:input,readOnly:true}),getAvailability:(start,end,typeId='')=>requestTenant('/availability?'+dateRangeParams({start,end,typeId})),
    saveRate:input=>mutate('/rates',input,'PUT'),addBlock:input=>mutate('/room-blocks',input),deleteBlock:id=>mutate('/room-blocks/'+enc(id),undefined,'DELETE'),
    saveInventoryMaster:(catalog,input)=>mutate('/inventory/masters/'+enc(catalog),input,input.id?'PATCH':'POST'),
    createInventoryDocument:(input,intent)=>mutateWithIntent('/inventory/documents',input,'POST',intent),
    reverseInventoryDocument:(id,input,intent)=>mutateWithIntent('/inventory/documents/'+enc(id)+'/reverse',input,'POST',intent),
    saveServiceStockLink:input=>mutate('/inventory/service-stock-links',input),
    returnPosStock:(id,input,intent)=>mutateWithIntent('/inventory/pos/'+enc(id)+'/returns',input,'POST',intent),
    savePricing:(catalog,input)=>mutate('/pricing/'+enc(catalog),input,input.id?'PATCH':'POST'),
    saveExchangeRate:input=>mutate('/pricing/exchange-rates',input,'PUT'),
    changePassword:input=>api.request('/api/auth/change-password',{method:'POST',body:input}),requestTenant,requestSystem,requestManagedTenant,saveTenant,available,createReceipt:unavailable,setTenants:unavailable,setFeatures:unavailable,setTenantFeatureOverrides:unavailable,
    getDashboardReport,getRevenueReport,getFinancialReport,getBusinessReport,listPlans,savePlan,deletePlan,getTenantSubscription,saveTenantSubscription,getSubscriptionHistory,
    listSystemUsers,saveSystemUser,getManagerFeatures,setGlobalFeature,saveFeatureOverride,removeFeatureOverride,
    listSaasInvoices,createSaasInvoice,recordSaasPayment,refundSaasPayment,getOperationalAccess,saveOperationalAccess,voidSaasInvoice,getManagerOverview,getManagerChannels,
    getOwnBilling,listOwnBillingInvoices,getOwnBillingInvoice,listOwnBillingHistory,
    getChannexAccounts,getChannexProperties,createChannexProperty,getChannexCatalog,getChannexBookings,getChannexInventory,
    getChannexRemoteChannels,
    getChannexChannelAdapters,getChannexChannel,probeChannexChannel,saveChannexChannel,actionChannexChannel,
    createChannexAirbnbLink,confirmChannexAirbnb,getChannexAirbnbListings,saveChannexAirbnbMapping,deleteChannexAirbnbMapping,
    saveChannexRoomType,saveChannexRatePlan,
    getCustomerHistory,searchCustomerAccounts,listCustomerAccounts,getOwnSessions,revokeOtherSessions,saveOwnProfile,
  };
  return <PmsContext.Provider value={value}>{children}</PmsContext.Provider>;
}
