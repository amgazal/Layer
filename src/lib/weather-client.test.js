import { it, expect, vi } from 'vitest';
import { fetchWeather, readWeatherCache, weatherTrust, precisePoints, correctCurrent, CORRECTION_MS, CACHE_KEY, weatherFreshness, locateOnce } from './weather-client';
const now=1800000000000;
const data={current:{actual:60,apparent:58,time:now/1000},hourly:{time:[now/1000]}};
it('rejects synthetic legacy cache and malformed or expired weather',()=>{
  expect(CACHE_KEY).not.toBe('layer:wx-cache:v7');
  for(const raw of [null,'bad',{at:now,data:{}},{at:now+100,data},{at:now-86400001,data}]) expect(readWeatherCache(raw,now)).toBeNull();
});
it('retains the real timestamp and distinguishes stale from recent',()=>{
  expect(readWeatherCache({at:now-60000,data},now).at).toBe(now-60000);
  expect(weatherTrust(data,now,now)).toBe('recent');
  expect(weatherTrust(data,now-3600000,now)).toBe('stale');
  expect(weatherTrust(data,now,now+86400001)).toBe('unavailable');
});
it('rejects network failure without making sample weather',async()=>{
  await expect(fetchWeather({fetcher:vi.fn().mockRejectedValue(new Error('offline'))})).rejects.toThrow('offline');
});
it('rejects bad provider temperatures',async()=>{
  await expect(fetchWeather({fetcher:async()=>({ok:true,json:async()=>({current:{temperature_2m:null}})})})).rejects.toThrow('Invalid weather');
});
it('limits precise locations to accurate Ithaca fixes',()=>{
  expect(precisePoints({latitude:42.4534,longitude:-76.4735,accuracy:50})).toHaveLength(5);
  expect(precisePoints({latitude:42.4534,longitude:-76.4735,accuracy:501})).toBeNull();
  expect(precisePoints({latitude:40,longitude:-73,accuracy:50})).toBeNull();
});
it('expires local reports exactly at fifteen minutes',()=>{
  const current={code:0,precipRate:0};
  expect(correctCurrent(current,{kind:'rain',at:now},now+CORRECTION_MS-1).code).toBe(61);
  expect(correctCurrent(current,{kind:'rain',at:now},now+CORRECTION_MS)).toBe(current);
  expect(correctCurrent({...current,code:61},{kind:'dry',at:now},now).precipRate).toBe(0);
});

it('separates provider cadence from retrieval staleness without extending expiry',()=>{
  const old = minutes => ({...data,current:{...data.current,time:(now-minutes*60000)/1000}});
  for (const minutes of [9,15,16,30]) expect(weatherTrust(old(minutes),now,now)).toBe('recent');
  expect(weatherTrust(old(31),now,now)).toBe('stale');
  expect(weatherTrust(data,now-900001,now)).toBe('stale');
  expect(weatherTrust(old(1441),now,now)).toBe('unavailable');
});
it('displays successful check age separately from source age',()=>{
  expect(weatherFreshness(now,now,'recent',false,false)).toBe('Updated now');
  expect(weatherFreshness(now-180000,now,'recent',false,false)).toBe('Updated 3 min ago');
  expect(weatherFreshness(now,now,'stale',false,false)).toBe('Weather may be outdated');
  expect(weatherFreshness(now,now,'recent',false,true)).toBe('Couldn’t update · Showing recent weather');
  expect(weatherFreshness(now,now,'stale',true,true)).toBe('Updating…');
});
it.each([
  [{latitude:42.4534,longitude:-76.4735,accuracy:20},null],
  [{latitude:42.4534,longitude:-76.4735,accuracy:900},'unavailable'],
  [{latitude:40,longitude:-73,accuracy:20},'outside'],
])('distinguishes geolocation result %j',async(coords,issue)=>{
  const result=await locateOnce({getCurrentPosition:success=>success({coords})});
  expect(result.issue).toBe(issue);
  expect(Boolean(result.points)).toBe(!issue);
});
it('handles denied or missing geolocation',async()=>{
  expect((await locateOnce({getCurrentPosition:(_,error)=>error({code:1})})).issue).toBe('unavailable');
  expect((await locateOnce(null)).issue).toBe('unavailable');
});
