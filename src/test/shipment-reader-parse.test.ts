import { describe, expect, it } from 'vitest';
import { parseScreenReading } from '../../supabase/functions/read-reefer-temperature/parse';

describe('parseScreenReading', () => {
  it('reads the temperature and set point from the model reply', () => {
    expect(parseScreenReading('{"readable": true, "temperature": 8.5, "set_point": -15}')).toEqual({ temperature: 8.5, setPoint: -15 });
  });

  it('copes with a code fence or a sentence around the JSON', () => {
    expect(parseScreenReading('```json\n{"readable":true,"temperature":-14.2,"set_point":-15}\n```')).toEqual({ temperature: -14.2, setPoint: -15 });
    expect(parseScreenReading('The display shows {"readable":true,"temperature":3,"set_point":null} as asked.')).toEqual({ temperature: 3, setPoint: null });
  });

  it('keeps the temperature when the set point is missing or absurd, and rounds to one decimal', () => {
    expect(parseScreenReading('{"readable":true,"temperature":8.46,"set_point":900}')).toEqual({ temperature: 8.5, setPoint: null });
  });

  it('gives nothing when the model says it cannot read the screen', () => {
    expect(parseScreenReading('{"readable": false, "temperature": null, "set_point": null}')).toBeNull();
    expect(parseScreenReading('{"readable": false, "temperature": 8.5, "set_point": -15}')).toBeNull();
  });

  it('gives nothing for an impossible temperature, a non-number, broken JSON or no JSON', () => {
    expect(parseScreenReading('{"readable":true,"temperature":185,"set_point":-15}')).toBeNull();
    expect(parseScreenReading('{"readable":true,"temperature":"8.5","set_point":-15}')).toBeNull();
    expect(parseScreenReading('{"readable":true,"temperature":')).toBeNull();
    expect(parseScreenReading('I cannot read this image.')).toBeNull();
    expect(parseScreenReading('')).toBeNull();
    expect(parseScreenReading('[1,2,3]')).toBeNull();
  });
});
