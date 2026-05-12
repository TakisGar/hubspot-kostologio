// Kostologio Worker v5.0
// Cloudflare Worker - Proxy for HubSpot API
// Set HUBSPOT_TOKEN as Cloudflare Worker environment variable/secret

const HUB='https://api.hubapi.com';
const CALC='https://takisgar.github.io/hubspot-kostologio/';

const corsH={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
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

    // /deal/:id -> get deal details
    const mDeal=p.match(/^\/deal\/([^/]+)$/);
    if(mDeal){
      const d=await hub('/crm/v3/objects/deals/'+mDeal[1]+'?properties=dealname,amount,dealstage,closedate,hubspot_owner_id,company',{},TOKEN);
      return new Response(JSON.stringify(d),{headers:corsH});
    }

    // /lineitems/:dealId -> get line items with cost (hs_cost_of_goods_sold)
    const mLi=p.match(/^\/lineitems\/([^/]+)$/);
    if(mLi){
      const d=await hub('/crm/v3/objects/deals/'+mLi[1]+'/associations/line_items',{},TOKEN);
      if(!d.results?.length)return new Response(JSON.stringify({results:[],status:'COMPLETE'}),{headers:corsH});
      const ids=d.results.map(r=>r.id||r.toObjectId);
      const batch=await hub('/crm/v3/objects/line_items/batch/read',{
        method:'POST',
        body:JSON.stringify({
          inputs:ids.map(id=>({id})),
          properties:['name','price','quantity','discount','hs_discount_percentage','hs_cost_of_goods_sold','hs_sku','hs_product_id','hs_line_item_currency_code']
        })
      },TOKEN);
      return new Response(JSON.stringify(batch),{headers:corsH});
    }

    // /products/:productId -> get product COGS and details
    const mProd=p.match(/^\/products\/([^/]+)$/);
    if(mProd){
      const d=await hub('/crm/v3/objects/products/'+mProd[1]+'?properties=name,price,hs_cost_of_goods_sold,hs_sku',{},TOKEN);
      return new Response(JSON.stringify(d),{headers:corsH});
    }

    // /seturl/:dealId -> set kostologio_url on deal
    const mSet=p.match(/^\/seturl\/([^/]+)$/);
    if(mSet){
      const calcUrl='https://takisgar.github.io/hubspot-kostologio/?dealId='+mSet[1];
      await hub('/crm/v3/objects/deals/'+mSet[1],{method:'PATCH',body:JSON.stringify({properties:{kostologio_url:calcUrl}})},TOKEN);
      return new Response(JSON.stringify({ok:true,url:calcUrl}),{headers:corsH});
    }

    // /updateall -> bulk update all deals with Worker URL
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

    return new Response(JSON.stringify({ok:true,version:'5.0',endpoints:['/open/:id','/deal/:id','/lineitems/:id','/products/:id','/seturl/:id','/updateall']}),{headers:corsH});
  }
};
