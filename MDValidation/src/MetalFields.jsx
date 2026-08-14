import { useCallback } from 'react';
import { Bar, Text, Check, YesNo } from './formUi';
import SignatureField from './SignatureField';
import { TRANSIT_TYPES, EJECTION_TYPES, SAMPLE_TYPES, blankProductSetup } from './formModel';

export default function MetalFields({ data, setData }) {
  const set = useCallback((key) => (e) => setData((d) => ({ ...d, [key]: e.target.value })), [setData]);
  const setVal = (key, val) => setData((d) => ({ ...d, [key]: val }));
  const setFactory = (k, field, val) => setData((d) => ({ ...d, factory: { ...d.factory, [k]: { ...d.factory[k], [field]: val } } }));
  const setSetup = (i, field, val) => setData((d) => ({ ...d, productSetups: d.productSetups.map((p, j) => (j === i ? { ...p, [field]: val } : p)) }));
  const setSetupDet = (i, k, field, val) => setData((d) => ({
    ...d,
    productSetups: d.productSetups.map((p, j) => (j === i ? { ...p, detection: { ...p.detection, [k]: { ...p.detection[k], [field]: val } } } : p)),
  }));
  const toggleEjection = (t) => setData((d) => {
    const has = (d.ejectionTypes || []).includes(t);
    return { ...d, ejectionTypes: has ? d.ejectionTypes.filter((x) => x !== t) : [...(d.ejectionTypes || []), t] };
  });
  const addSetup = () => setData((d) => ({ ...d, productSetups: [...d.productSetups, blankProductSetup()] }));
  const removeSetup = (i) => setData((d) => ({ ...d, productSetups: d.productSetups.filter((_, j) => j !== i) }));
  const pick = (key, val) => () => setVal(key, data[key] === val ? '' : val);

  return (
    <>
      <div className="fldrow">
        <Text label="Certificate No." value={data.certificateNo} onChange={set('certificateNo')} />
      </div>

      <Bar>Customer Information</Bar>
      <div className="fldrow">
        <Text label="Company" value={data.company} onChange={set('company')} />
        <Text label="Address" value={data.address} onChange={set('address')} />
      </div>
      <div className="fldrow">
        <Text label="Customer Contact" value={data.customerContact} onChange={set('customerContact')} />
        <Text label="Position" value={data.position} onChange={set('position')} />
      </div>
      <div className="fldrow">
        <Text label="Phone" value={data.phone} onChange={set('phone')} />
        <Text label="Email" value={data.email} onChange={set('email')} />
      </div>

      <Bar>Metal Detector Information</Bar>
      <div className="fldrow">
        <Text label="Brand" value={data.brand} onChange={set('brand')} />
        <Text label="Model" value={data.model} onChange={set('model')} />
      </div>
      <div className="fldrow">
        <Text label="Serial Number" value={data.serialNumber} onChange={set('serialNumber')} />
        <Text label="Dimensions" value={data.dimensions} onChange={set('dimensions')} />
      </div>

      <Bar>Transit Type</Bar>
      <div className="checks">
        {TRANSIT_TYPES.map((t) => (
          <Check key={t} label={t} checked={data.transitType === t} onClick={pick('transitType', t)} />
        ))}
      </div>

      <Bar>Ejection Type</Bar>
      <div className="checks">
        {EJECTION_TYPES.filter((t) => t !== 'Other').map((t) => (
          <Check key={t} label={t} checked={(data.ejectionTypes || []).includes(t)} onClick={() => toggleEjection(t)} />
        ))}
        <Check label="Other" checked={(data.ejectionTypes || []).includes('Other')} onClick={() => toggleEjection('Other')} />
        <Text label="Other (describe)" value={data.ejectionOther} onChange={set('ejectionOther')} />
      </div>

      <Bar>Product Default Detection (Factory Default)</Bar>
      <div className="sampletable">
        <div className="sthead"><span>Sample Type</span><span>Diameter</span><span>Manufacturer</span><span>Serial Number</span><span>Detected</span></div>
        {SAMPLE_TYPES.map((s) => {
          const r = data.factory[s.key];
          return (
            <div className="strow" key={s.key}>
              <span className="stname">{s.label}</span>
              <label className="cellfld"><span className="celllbl">Diameter</span>
                <input value={r.diameter} onChange={(e) => setFactory(s.key, 'diameter', e.target.value)} /></label>
              <label className="cellfld"><span className="celllbl">Manufacturer</span>
                <input value={r.manufacturer} onChange={(e) => setFactory(s.key, 'manufacturer', e.target.value)} /></label>
              <label className="cellfld"><span className="celllbl">Serial Number</span>
                <input value={r.serial} onChange={(e) => setFactory(s.key, 'serial', e.target.value)} /></label>
              <span className="yesno">
                <span className="celllbl">Detected</span>
                <Check label="Yes" checked={r.detected === 'Yes'} onClick={() => setFactory(s.key, 'detected', r.detected === 'Yes' ? '' : 'Yes')} />
                <Check label="No" checked={r.detected === 'No'} onClick={() => setFactory(s.key, 'detected', r.detected === 'No' ? '' : 'No')} />
              </span>
            </div>
          );
        })}
      </div>

      <Bar>Product Description and Observation</Bar>
      <div className="fldrow">
        <Text label="Product Type" value={data.productType} onChange={set('productType')} />
        <div className="checks">
          <Check label="Wet" checked={data.wetDry === 'Wet'} onClick={pick('wetDry', 'Wet')} />
          <Check label="Dry" checked={data.wetDry === 'Dry'} onClick={pick('wetDry', 'Dry')} />
        </div>
      </div>
      <YesNo label="Metal Detector in production" value={data.inProduction} onPick={(v) => setVal('inProduction', v)} />
      <YesNo label="Is system stable" value={data.systemStable} onPick={(v) => setVal('systemStable', v)} />
      <div className="fldrow">
        <Text label="Baseline Readings — Bars (product noise)" value={data.baselineBars} onChange={set('baselineBars')} />
        <Text label="Baseline Readings — Stars (product noise)" value={data.baselineStars} onChange={set('baselineStars')} />
      </div>
      <YesNo label="Is system damaged" value={data.systemDamaged} onPick={(v) => setVal('systemDamaged', v)} />
      <label className="area"><span>Detailed Observation if Unstable and/or Damaged</span>
        <textarea rows="4" value={data.detailedObservation} onChange={set('detailedObservation')} /></label>

      {data.productSetups.map((p, i) => (
        <div key={i} className="setup">
          <Bar>
            Product Setup {i + 1}
            {data.productSetups.length > 1 && (
              <button type="button" className="rm" onClick={() => removeSetup(i)}>Remove</button>
            )}
          </Bar>
          <div className="fldrow">
            <Text label="Product Name" value={p.productName} onChange={(e) => setSetup(i, 'productName', e.target.value)} />
            <Text label="Product Description" value={p.productDescription} onChange={(e) => setSetup(i, 'productDescription', e.target.value)} />
          </div>
          <div className="fldrow">
            <Text label="Sensitivity" value={p.sensitivity} onChange={(e) => setSetup(i, 'sensitivity', e.target.value)} />
            <Text label="Band" value={p.band} onChange={(e) => setSetup(i, 'band', e.target.value)} />
            <Text label="TX Program" value={p.txProgram} onChange={(e) => setSetup(i, 'txProgram', e.target.value)} />
            <Text label="Belt Speed" value={p.beltSpeed} onChange={(e) => setSetup(i, 'beltSpeed', e.target.value)} />
          </div>
          <div className="fldrow">
            <Text label="Ejection Mode" value={p.ejectionMode} onChange={(e) => setSetup(i, 'ejectionMode', e.target.value)} />
            <Text label="Ejection Distance" value={p.ejectionDistance} onChange={(e) => setSetup(i, 'ejectionDistance', e.target.value)} />
            <Text label="Ejection Time" value={p.ejectionTime} onChange={(e) => setSetup(i, 'ejectionTime', e.target.value)} />
          </div>
          <div className="fldrow">
            <Text label="Noise Signal Running" value={p.noiseRunning} onChange={(e) => setSetup(i, 'noiseRunning', e.target.value)} />
            <Text label="Noise Signal Ejecting" value={p.noiseEjecting} onChange={(e) => setSetup(i, 'noiseEjecting', e.target.value)} />
          </div>
          <div className="subbar">Metal Detection During Production</div>
          <div className="sampletable">
            <div className="sthead prod"><span>Sample Type</span><span>Diameter</span><span>Detected</span><span>Ejected</span></div>
            {SAMPLE_TYPES.map((s) => {
              const r = p.detection[s.key];
              return (
                <div className="strow prod" key={s.key}>
                  <span className="stname">{s.label}</span>
                  <label className="cellfld"><span className="celllbl">Diameter</span>
                    <input value={r.diameter} onChange={(e) => setSetupDet(i, s.key, 'diameter', e.target.value)} /></label>
                  <span className="ctr"><span className="celllbl">Detected</span><Check label="" checked={!!r.detected} onClick={() => setSetupDet(i, s.key, 'detected', !r.detected)} /></span>
                  <span className="ctr"><span className="celllbl">Ejected</span><Check label="" checked={!!r.ejected} onClick={() => setSetupDet(i, s.key, 'ejected', !r.ejected)} /></span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" className="btn add" onClick={addSetup}>+ Add Product Setup</button>

      <Bar>Metal Detector Validation Results</Bar>
      <div className="checks">
        <Check label="PASS" checked={data.validationResult === 'Pass'} onClick={pick('validationResult', 'Pass')} />
        <Check label="FAIL" checked={data.validationResult === 'Fail'} onClick={pick('validationResult', 'Fail')} />
      </div>

      <label className="area"><span>Final Notes and Observations</span>
        <textarea rows="5" value={data.finalNotes} onChange={set('finalNotes')} /></label>

      <Bar>Customer Acknowledgement and Signatures</Bar>
      <div className="fldrow">
        <Text label="Date of Validation" value={data.dateOfValidation} onChange={set('dateOfValidation')} />
        <Text label="Renewal Date" value={data.renewalDate} onChange={set('renewalDate')} />
      </div>
      <div className="fldrow">
        <Text label="Customer Representative" value={data.customerRepresentative} onChange={set('customerRepresentative')} />
        <Text label="Validator Name" value={data.validatorName} onChange={set('validatorName')} />
      </div>
      <div className="fldrow sigs">
        <SignatureField label="Customer Signature" value={data.customerSignatureImg} onChange={(img) => setVal('customerSignatureImg', img)} />
        <SignatureField label="Validator Signature" value={data.validatorSignatureImg} onChange={(img) => setVal('validatorSignatureImg', img)} />
      </div>
      <div className="endpad" />
    </>
  );
}
