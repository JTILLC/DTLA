import { useCallback } from 'react';
import { Bar, Text, Check, YesNo } from './formUi';
import SignatureField from './SignatureField';
import { blankSample } from './xrayModel';
import { XRAY_DIAGRAM } from './xrayDiagram';
import { XRAY_OVALS, XRAY_CALLOUTS } from './xrayOvals';

export default function XrayFields({ data, setData }) {
  const set = useCallback((key) => (e) => setData((d) => ({ ...d, [key]: e.target.value })), [setData]);
  const setVal = (key, val) => setData((d) => ({ ...d, [key]: val }));
  const setOval = (n, val) => setData((d) => ({ ...d, ovals: { ...d.ovals, [n]: val } }));
  const setSample = (i, field, val) => setData((d) => ({ ...d, samples: d.samples.map((s, j) => (j === i ? { ...s, [field]: val } : s)) }));
  const addSample = () => setData((d) => ({ ...d, samples: [...d.samples, blankSample()] }));
  const removeSample = (i) => setData((d) => ({ ...d, samples: d.samples.filter((_, j) => j !== i) }));
  const pick = (key, val) => () => setVal(key, data[key] === val ? '' : val);

  return (
    <>
      <Bar>Machine &amp; Customer Information</Bar>
      <div className="fldrow">
        <Text label="Model Information" value={data.modelInformation} onChange={set('modelInformation')} />
        <Text label="Customer Name" value={data.customerName} onChange={set('customerName')} />
      </div>
      <div className="fldrow">
        <Text label="Job Number" value={data.jobNumber} onChange={set('jobNumber')} />
        <Text label="Customer Location" value={data.customerLocation} onChange={set('customerLocation')} />
      </div>
      <div className="fldrow">
        <Text label="Serial Number" value={data.serialNumber} onChange={set('serialNumber')} />
        <Text label="Customer Contact" value={data.customerContact} onChange={set('customerContact')} />
      </div>

      <Bar>Radiation Detected — enter the amount in each oval</Bar>
      <div className="xraydiagramwrap">
        <div className="xraydiagram">
          <img src={XRAY_DIAGRAM} alt="X-ray machine diagram" />
          <svg className="ovallines" viewBox="0 0 100 100" preserveAspectRatio="none">
            {XRAY_OVALS.map((o) => {
              const c = XRAY_CALLOUTS[o.n] || o;
              return <line key={o.n} x1={o.x} y1={o.y} x2={c.x} y2={c.y} stroke="#1565c0" strokeWidth="0.25" />;
            })}
          </svg>
          {XRAY_OVALS.map((o) => {
            const pos = XRAY_CALLOUTS[o.n] || o; // tight ovals get their callout spot
            return (
              <input
                key={o.n}
                className="ovalinput"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                value={(data.ovals && data.ovals[o.n]) || ''}
                onChange={(e) => setOval(o.n, e.target.value)}
                aria-label={`Oval ${o.n}`}
              />
            );
          })}
        </div>
      </div>

      <Bar>Sample Sizes for Foreign Material (mm)</Bar>
      <div className="fldrow">
        <Text label="Product Description" value={data.productDescription} onChange={set('productDescription')} />
        <Text label="Packaging Material" value={data.packagingMaterial} onChange={set('packagingMaterial')} />
      </div>
      <div className="fldrow">
        <Text label="Package Weight" value={data.packageWeight} onChange={set('packageWeight')} />
      </div>

      <Bar>Test Samples Detected</Bar>
      <div className="sampletable">
        <div className="sthead xray"><span>Sample Type</span><span>Sample Sizes (mm)</span><span></span></div>
        {data.samples.map((s, i) => (
          <div className="strow xray" key={i}>
            <label className="cellfld"><span className="celllbl">Sample Type</span>
              <input value={s.type} onChange={(e) => setSample(i, 'type', e.target.value)} /></label>
            <label className="cellfld"><span className="celllbl">Sample Sizes (mm)</span>
              <input value={s.size} onChange={(e) => setSample(i, 'size', e.target.value)} /></label>
            <span className="ctr">
              {data.samples.length > 1 && <button type="button" className="rm" onClick={() => removeSample(i)}>Remove</button>}
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="btn add" onClick={addSample}>+ Add Sample</button>

      <Bar>Machine Diagnostics</Bar>
      <YesNo label="Was each package rejected?" value={data.packageRejected} onPick={(v) => setVal('packageRejected', v)} />
      <div className="fldrow">
        <Text label="Corrections" value={data.corrections} onChange={set('corrections')} />
      </div>
      <div className="fldrow">
        <Text label="Max Irradiation" value={data.maxIrradiation} onChange={set('maxIrradiation')} />
        <Text label="Voltage" value={data.voltage} onChange={set('voltage')} />
        <Text label="Current" value={data.current} onChange={set('current')} />
      </div>
      <div className="fldrow">
        <Text label="Line Sensor" value={data.lineSensor} onChange={set('lineSensor')} />
        <Text label="Generator Hours" value={data.generatorHours} onChange={set('generatorHours')} />
      </div>
      <div className="fldrow">
        <Text label="X-Ray Lamp" value={data.xrayLamp} onChange={set('xrayLamp')} />
        <Text label="Safety Circuits" value={data.safetyCircuits} onChange={set('safetyCircuits')} />
      </div>

      <Bar>Validation Result</Bar>
      <div className="checks">
        <Check label="PASS" checked={data.result === 'Pass'} onClick={pick('result', 'Pass')} />
        <Check label="FAIL" checked={data.result === 'Fail'} onClick={pick('result', 'Fail')} />
      </div>
      <div className="fldrow">
        <Text label="Date" value={data.date} onChange={set('date')} />
        <Text label="Date Due" value={data.dateDue} onChange={set('dateDue')} />
      </div>

      <Bar>Signatures</Bar>
      <div className="fldrow">
        <Text label="Surveyor" value={data.surveyor} onChange={set('surveyor')} />
        <Text label="Customer Representative" value={data.customerRepresentative} onChange={set('customerRepresentative')} />
      </div>
      <div className="fldrow sigs">
        <SignatureField label="Surveyor Signature" value={data.surveyorSignatureImg} onChange={(img) => setVal('surveyorSignatureImg', img)} />
        <SignatureField label="Customer Signature" value={data.customerSignatureImg} onChange={(img) => setVal('customerSignatureImg', img)} />
      </div>
      <div className="endpad" />
    </>
  );
}
