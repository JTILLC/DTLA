import { useCallback } from 'react';
import { Bar, Text, Check, YesNo } from './formUi';
import SignatureField from './SignatureField';

export default function CheckweigherFields({ data, setData }) {
  const set = useCallback((key) => (e) => setData((d) => ({ ...d, [key]: e.target.value })), [setData]);
  const setVal = (key, val) => setData((d) => ({ ...d, [key]: val }));
  const setPos = (key, val) => setData((d) => ({ ...d, positionReadings: { ...d.positionReadings, [key]: val } }));
  const setSample = (i, val) => setData((d) => ({ ...d, sampleWeights: d.sampleWeights.map((s, j) => (j === i ? val : s)) }));

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

      <Bar>Checkweigher Checks</Bar>
      <YesNo label="Does checkweigher zero adjust?" value={data.zeroAdjust} onPick={(v) => setVal('zeroAdjust', v)} />
      <div className="checks"><span className="inlbl">Verify weight fluctuation is minimal:</span></div>
      <div className="fldrow">
        <Text label="Lowest weight reading" value={data.lowestWeight} onChange={set('lowestWeight')} />
        <Text label="Highest weight reading" value={data.highestWeight} onChange={set('highestWeight')} />
      </div>
      <div className="checks">
        <Check label="Perform Span Adjustment" checked={!!data.performSpanAdjustment} onClick={() => setVal('performSpanAdjustment', !data.performSpanAdjustment)} />
      </div>
      <div className="fldrow">
        <Text label="Span Calibration weight size" value={data.spanCalWeightSize} onChange={set('spanCalWeightSize')} />
      </div>

      <Bar>Position Readings</Bar>
      <div className="fldrow">
        <Text label="1 — Top Left" value={data.positionReadings.topLeft} onChange={(e) => setPos('topLeft', e.target.value)} />
        <Text label="2 — Top Right" value={data.positionReadings.topRight} onChange={(e) => setPos('topRight', e.target.value)} />
        <Text label="3 — Bottom Left" value={data.positionReadings.bottomLeft} onChange={(e) => setPos('bottomLeft', e.target.value)} />
        <Text label="4 — Bottom Right" value={data.positionReadings.bottomRight} onChange={(e) => setPos('bottomRight', e.target.value)} />
      </div>

      <Bar>Sample Weight Tests (20)</Bar>
      <div className="cwgrid">
        {data.sampleWeights.map((s, i) => (
          <input key={i} value={s} onChange={(e) => setSample(i, e.target.value)} placeholder={`${i + 1}`} aria-label={`Sample ${i + 1}`} />
        ))}
      </div>
      <label className="area"><span>Comments</span>
        <textarea rows="3" value={data.comments} onChange={set('comments')} /></label>

      <Bar>Sample Information and Description</Bar>
      <div className="fldrow">
        <Text label="Product" value={data.product} onChange={set('product')} />
        <Text label="Speed" value={data.speed} onChange={set('speed')} />
      </div>
      <div className="fldrow">
        <Text label="Actual Weight" value={data.actualWeight} onChange={set('actualWeight')} />
        <Text label="Mean Weight" value={data.meanWeight} onChange={set('meanWeight')} />
        <Text label="Standard Deviation" value={data.standardDeviation} onChange={set('standardDeviation')} />
      </div>

      <Bar>Signatures</Bar>
      <div className="fldrow">
        <Text label="Customer Name (print)" value={data.signerName} onChange={set('signerName')} />
      </div>
      <div className="fldrow">
        <Text label="Customer Date" value={data.customerDate} onChange={set('customerDate')} />
        <Text label="Validator Date" value={data.validatorDate} onChange={set('validatorDate')} />
      </div>
      <div className="fldrow sigs">
        <SignatureField label="Customer Signature" value={data.customerSignatureImg} onChange={(img) => setVal('customerSignatureImg', img)} />
        <SignatureField label="Validator Signature" value={data.validatorSignatureImg} onChange={(img) => setVal('validatorSignatureImg', img)} />
      </div>
      <div className="endpad" />
    </>
  );
}
