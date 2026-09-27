import { it, expect, vi } from 'vitest';
import { fetchWeather, readWeatherCache, weatherTrust, precisePoints, correctCurrent, CORRECTION_MS, CACHE_KEY } from './weather-client';
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
