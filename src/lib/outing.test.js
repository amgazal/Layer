import { describe, it, expect } from 'vitest';
import { buildOuting, outingTemperature, personalTemperature } from './outing';
import { EMPTY_MODEL } from './model';
const start = 1800000000000;
function weather(temps, extra = {}) {
  const series = { time: temps.map((_,i) => start/1000+i*900), temperature_2m: temps,
    apparent_temperature: temps, weather_code: temps.map(()=>0), is_day: temps.map(()=>1),
    wind_speed_10m: temps.map(()=>5), wind_gusts_10m: temps.map(()=>8), precipitation: temps.map(()=>0), ...extra };
  return { current: { time:start/1000, actual:temps[0], apparent:temps[0], wind:5,gust:8,precip:0,precipRate:0,code:0,isDay:1 }, minutely:series, hourly:{...series,precipitation_probability:temps.map(()=>0)} };
}
const calculate = (wx,d) => outingTemperature(buildOuting(wx,start,d),EMPTY_MODEL,'walking',false);
describe('whole outing exposure',()=>{
  it('protects against sustained cooling, with a modular departure outfit',()=>{
    const wx=weather(Array.from({length:17},(_,i)=>67-Math.min(i,8)*13/8));
    const short=calculate(wx,20), hour=calculate(wx,60), two=calculate(wx,120), four=calculate(wx,240);
    expect(short.effective).toBeGreaterThan(hour.effective);
    expect(hour.effective).toBeGreaterThan(two.effective);
    expect(two.effective).toBeGreaterThanOrEqual(four.effective);
    expect(two.cooling).toBe(true); expect(two.wearEffective).toBe(69);
  });
  it('explains removable layers for a warming outing',()=>{
    expect(calculate(weather(Array.from({length:17},(_,i)=>48+i)),240).warming).toBe(true);
  });
  it.each([20,60,120,240])('does not add a duration penalty in steady weather (%i)',d=>{
    expect(calculate(weather(Array(17).fill(67)),d).effective).toBe(69);
  });
  it('does not dress for one extreme quarter-hour all day',()=>{
    const temps=Array(17).fill(67); temps[8]=35;
    expect(calculate(weather(temps),240).effective).toBe(69);
  });
  it('keeps dry departure separate from later precipitation',()=>{
    const wx=weather(Array(17).fill(67),{precipitation:[0,0,.4,...Array(14).fill(0)]});
    const plan=buildOuting(wx,start,60);
    expect(plan.depart.precipRate).toBe(0); expect(plan.peakRainRate).toBe(1.6);
  });
  it('retains current rain even if it ends shortly',()=>{
    const wx=weather(Array(17).fill(67)); wx.current.precipRate=2;
    expect(buildOuting(wx,start,20).peakRainRate).toBe(2);
  });
  it('accounts for future gusts and daylight ending',()=>{
    const wx=weather(Array(17).fill(67),{wind_gusts_10m:Array(17).fill(40),is_day:[1,...Array(16).fill(0)]});
    const plan=buildOuting(wx,start,240);
    expect(plan.peakGust).toBe(40); expect(plan.nightBegins).toBe(true);
    const model={...EMPTY_MODEL,factors:{wind:0,wet:0,sun:7}};
    expect(personalTemperature({...plan.points[1],apparent:80},model,'walking',false)).toBe(82);
  });
  it('falls back to hourly beyond the minutely horizon and rejects incomplete coverage',()=>{
    const wx=weather(Array(17).fill(60)); wx.minutely.time=wx.minutely.time.slice(0,2);
    expect(buildOuting(wx,start,240).points.at(-1).apparent).toBe(60);
    wx.hourly.time=wx.hourly.time.slice(0,2);
    expect(buildOuting(wx,start,240)).toBeNull();
  });
});
