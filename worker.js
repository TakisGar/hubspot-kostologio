h// Kostologio Worker v6.0
// Cloudflare Worker - Proxy for HubSpot API
// Set HUBSPOT_TOKEN as Cloudflare Worker environment variable/secret

const HUB='https://api.hubapi.com';
const CALC='https://takisgar.github.io/hubspot-kostologio/';

const corsH={
  'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type,Authorization',
  'Content-Type':'application/json'
};

async function hub(path,init={},token){
  const r=await fetch(HUB+path,{...init,headers:{...init.headers,'Authorization':'Bearer '+token,'Content-Type':'application/json'}});
  return r.json();
}

export default{
  async fetch(req,env){
    const TOKEN=env?.HUBSPOT_TOKEN||'';
    if(req.method==='OPTIONS')return new Response(null,{headers:corsH});
    const u=new URL(req.url);
    const p=u.pathname;

    // /open/:dealId -> redirect to calculator
    const mOpen=p.match(/^\/open\/([^/]+)$/);
    if(mOpen)return Response.redirect(CALC+'?dealId='+mOpen[1],302);

    // /deal/:id -> get deal details (legacy singular)
    const mDealSingular=p.match(/^\/deal\/([^/]+)$/);
    if(mDealSingular){
      const id=mDealSingular[1];
      const d=await hub('/crm/v3/objects/deals/'+id+'?properties=dealname,amount,dealstage,closedate,hubspot_owner_id',{},TOKEN);
      return new Response(JSON.stringify(d),{headers:corsH});
    }

    // /deals/search?q= -> search deals by name
    if(p==='/deals/search'){
      const q=u.searchParams.get('q')||'';
      const body={filterGroups:[{filters:[{propertyName:'dealname',operator:'CONTAINS_TOKEN',value:q}]}],properties:['dealname','amount','dealstage','closedate'],limit:10};
      const data=await hub('/crm/v3/objects/deals/search',{method:'POST',body:JSON.stringify(body)},TOKEN);
      const results=(data.results||[]).map(d=>({id:d.id,name:d.properties?.dealname||'',amount:d.properties?.amount||'',stage:d.properties?.dealstage||''}));
      return new Response(JSON.stringify({results}),{headers:corsH});
    }

    // /deals/:id -> get deal + line items combined (used by calculator)
    const mDeal=p.match(/^\/deals\/([^/]+)$/);
    if(mDeal){
      const id=mDeal[1];
      const [dealData,assocData]=await Promise.all([
        hub('/crm/v3/objects/deals/'+id+'?properties=dealname,amount,dealstage,closedate,hubspot_owner_id',{},TOKEN),
        hub('/crm/v3/objects/deals/'+id+'/associations/line_items',{},TOKEN)
      ]);
      let lineItems=[];
      const ids=(assocData.results||[]).map(r=>r.id||r.toObjectId);
      if(ids.length){
        const batch=await hub('/crm/v3/objects/line_items/batch/read',{
          method:'POST',
          body:JSON.stringify({inputs:ids.map(id=>({id})),properties:['name','price','quantity','discount','hs_discount_percentage','hs_cost_of_goods_sold','hs_sku','hs_product_id','hs_line_item_currency_code']})
        },TOKEN);
        lineItems=(batch.results||[]).map(li=>({
          id:li.id,
          name:li.properties?.name||'',
          sku:li.properties?.hs_sku||'',
          product_id:li.properties?.hs_product_id||'',
          price:parseFloat(li.properties?.price)||0,
          quantity:parseFloat(li.properties?.quantity)||1,
          discount:parseFloat(li.properties?.hs_discount_percentage||li.properties?.discount)||0,
          unit_cost:parseFloat(li.properties?.hs_cost_of_goods_sold)||0,
          currency:li.properties?.hs_line_item_currency_code||'EUR'
        }));
      }
      const props=dealData.properties||{};
      return new Response(JSON.stringify({
        id:dealData.id,
        name:props.dealname||'',
        amount:props.amount||'',
        stage:props.dealstage||'',
        properties:props,
        lineItems
      }),{headers:corsH});
    }

    // /contacts/search?q= -> search contacts by name/email
    if(p==='/contacts/search'){
      const q=u.searchParams.get('q')||'';
      const body={filterGroups:[{filters:[{propertyName:'firstname',operator:'CONTAINS_TOKEN',value:q}]},{filters:[{filters:[{propertyName:'lastname',operator:'CONTAINS_TOKEN',value:q}]}]},{filters:[{filters:[{propertyName:'email',operator:'CONTAINS_TOKEN',value:q}]}]}],properties:['firstname','lastname','email','phone'],limit:10};
      const data=await hub('/crm/v3/objects/contacts/search',{method:'POST',body:JSON.stringify(body)},TOKEN);
      const results=(data.results||[]).map(c=>({id:c.id,firstname:c.properties?.firstname||'',lastname:c.properties?.lastname||'',email:c.properties?.email||'',phone:c.properties?.phone||''}));
      return new Response(JSON.stringify({results}),{headers:corsH});
    }

    // /lineitems/:dealId -> get line items with cost (legacy endpoint)
    const mLi=p.match(/^\/lineitems\/([^/]+)$/);
    if(mLi){
      const d=await hub('/crm/v3/objects/deals/'+mLi[1]+'/associations/line_items',{},TOKEN);
      if(!d.results?.length)return new Response(JSON.stringify({results:[],status:'COMPLETE'}),{headers:corsH});
      const ids=d.results.map(r=>r.id||r.toObjectId);
      const batch=await hub('/crm/v3/objects/line_items/batch/read',{
        method:'POST',
        body:JSON.stringify({inputs:ids.map(id=>({id})),properties:['name','price','quantity','discount','hs_discount_percentage','hs_cost_of_goods_sold','hs_sku','hs_product_id','hs_line_item_currency_code']})
      },TOKEN);
      return new Response(JSON.stringify(batch),{headers:corsH});
    }

    // /products/:productId -> get product COGS and details
    const mProd=p.match(/^\/products\/([^/]+)$/);
    if(mProd){
      const d=await hub('/crm/v3/objects/products/'+mProd[1]+'?properties=name,price,hs_cost_of_goods_sold,hs_sku',{},TOKEN);
      return new Response(JSON.stringify(d),{headers:corsH});
    }

    // /deals/:id PATCH -> update deal properties
            const mDealPatch=p.match(/^\/deals\/([^/]+)$/);
            if(mDealPatch&&req.method==='PATCH'){const body=await req.json();const d=await hub('/crm/v3/objects/deals/'+mDealPatch[1],{method:'PATCH',body:JSON.stringify({properties:body})},TOKEN);return new Response(JSON.stringify(d),{headers:corsH});}
    const mSet=p.match(/^\/seturl\/([^/]+)$/);
    if(mSet){
      const calcUrl='https://takisgar.github.io/hubspot-kostologio/?dealId='+mSet[1];
      await hub('/crm/v3/objects/deals/'+mSet[1],{method:'PATCH',body:JSON.stringify({properties:{kostologio_url:calcUrl}})},TOKEN);
      return new Response(JSON.stringify({ok:true,url:calcUrl}),{headers:corsH});
    }

    // /updateall -> bulk update all deals with correct calculator URL
    if(p==='/updateall'){
      const list=await hub('/crm/v3/objects/deals?properties=kostologio_url&limit=100',{},TOKEN);
      const deals=list.results||[];
      const results=await Promise.allSettled(deals.map(async d=>{
        const calcUrl='https://takisgar.github.io/hubspot-kostologio/?dealId='+d.id;
        await hub('/crm/v3/objects/deals/'+d.id,{method:'PATCH',body:JSON.stringify({properties:{kostologio_url:calcUrl}})},TOKEN);
        return d.id;
      }));
      const updated=results.filter(r=>r.status==='fulfilled').length;
      const errors=results.filter(r=>r.status==='rejected').length;
      return new Response(JSON.stringify({updated,errors,total:deals.length}),{headers:corsH});
    }

    return new Response(JSON.stringify({ok:true,version:'6.0',endpoints:['/open/:id','/deal/:id','/deals/:id','/deals/search','/contacts/search','/lineitems/:id','/products/:id','/seturl/:id','/updateall']}),{headers:corsH});
  }
};
