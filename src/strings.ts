/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const STRINGS = {
  app: {
    title: 'DustWatch',
    subtitle: 'UAE 12-Hour Dust Risk Outlook',
    badge: 'Experimental Student Project',
    tagline: 'Estimating short-term dust risk across the UAE from open forecast data.',
  },

  disclaimer: {
    barText: 'DustWatch is an experimental student project. It gives estimated risk only, not an official warning.',
    ncmUrl: 'https://www.ncm.ae',
    ncmLinkLabel: 'Check official alerts at ncm.ae',
  },

  nav: {
    map: 'Map',
    schoolMode: 'School Mode',
    howItWorks: 'How it works',
    accuracy: 'Accuracy',
    testView: 'Test view',
  },

  banners: {
    sampleData: 'Showing saved sample data, not live data',
    sampleDataBadge: 'SAMPLE DATA (synthetic, for layout testing only)',
    cachedFallback: (time: string) => `Live data unavailable. Showing the last live data from ${time}.`,
    snapshotLoaded: (time: string) => `Saved real snapshot from ${time}`,
    demoModeActive: 'Demo mode active (saved data)',
  },

  toggles: {
    highest12h: 'Highest in next 12 hours',
    now: 'Now',
    demoMode: 'Demo mode (saved data)',
    refresh: 'Refresh',
    refreshing: 'Refreshing data...',
    lastUpdated: (time: string) => `Last updated: ${time} (Asia/Dubai)`,
  },

  panel: {
    riskNow: 'Risk now',
    highestNext12h: 'Highest in next 12 hours',
    atHour: (time: string) => `at ${time}`,
    confidence: 'Confidence',
    bestWindow: 'Best 3-hour window',
    worstWindow: 'Worst 3-hour window',
    timelineTitle: '12-Hour Dust Risk Timeline',
    showAsChart: 'Show as chart',
    showAsTable: 'Show as table',
    hourCol: 'Hour',
    riskCol: 'Risk Level',
    scoreCol: 'Score (0-100)',
    keyFactorsCol: 'Key Factors',
    satelliteLink: 'View satellite imagery (NASA Worldview)',
    satelliteNote: 'For context only. Not used in the risk score.',
    satelliteUrl: 'https://worldview.earthdata.nasa.gov',
    dataSources: 'Weather: Open-Meteo weather forecast. Air quality and dust: Open-Meteo air-quality forecast (model-based).',
  },

  whyThisRating: {
    title: 'Why this rating',
    hourSubtitle: (hour: string) => `Detailed factor breakdown for ${hour}`,
    scoredFactors: 'Scored atmospheric factors',
    contextFactors: 'Contextual factors (not scored)',
    topContributors: 'Biggest contributors to score',
    missingDataWarning: 'Missing variables for this hour',
    particleCapNotice: 'Particle cap applied: dust and PM10 sub-scores are below 10, capping total score at 24 so wind alone cannot trigger High or Very High.',
    scientificCaution: 'Scientific caution: PM10 and PM2.5 measure all particles, including smoke and pollution, not only dust. Always say "estimated risk", never "will happen".',
    activeModeBaseline: 'Using the baseline rule score (no trained model loaded)',
    activeModeModel: (name: string, ver: string, date: string) => `Using trained model: ${name} (v${ver}, trained ${date})`,
    comparisonTitle: 'Baseline vs. Model Comparison',
    baselineComparison: (bLevel: string, bScore: number, mLevel: string, mScore: number) =>
      `Baseline rule score: ${bLevel} (${bScore}) | Active model prediction: ${mLevel} (${mScore})`,
  },

  advice: {
    highestPrefix: (level: string, window: string) => `Highest estimated risk: ${level}, ${window}`,
    tabSchools: 'Schools',
    tabWorkers: 'Outdoor workers',
    tabFamilies: 'Families and health',
    preparing: 'Preparing advice...',
    aiAttribution: 'Explanation written by Gemini AI from our risk result. The risk level is calculated by DustWatch, not by Gemini.',
    standardAttribution: 'Standard advice for this risk level (not AI-generated). The risk level is calculated by DustWatch.',
    
    // Fixed fallback advice
    fixed: {
      Low: {
        schools: 'Normal outdoor activities are fine. Keep an eye on conditions through the day.',
        workers: 'Normal outdoor work is fine. Keep drinking water and watch for any change in conditions.',
        families: 'Normal day outdoors, but people with breathing conditions should follow their doctor\'s advice. Official warnings come from the UAE National Center of Meteorology.',
      },
      Moderate: {
        schools: 'Outdoor activities can go ahead. Be ready to move students indoors if the air looks dusty or hazy.',
        workers: 'Outdoor work can continue. Take regular breaks in shade or indoors and watch for changing conditions.',
        families: 'Sensitive people may prefer shorter time outdoors, and those with breathing conditions should follow their doctor\'s advice. Official warnings come from the UAE National Center of Meteorology.',
      },
      High: {
        schools: 'Consider moving PE and break time indoors. Keep windows and doors closed if it becomes dusty.',
        workers: 'Limit heavy outdoor work where possible and follow your workplace safety rules. Plan breaks indoors.',
        families: 'Try to stay indoors where possible and keep windows closed. People with breathing conditions should follow their doctor\'s advice, and official warnings come from the UAE National Center of Meteorology.',
      },
      'Very High': {
        schools: 'Keep students indoors and avoid outdoor activities. Follow your school\'s guidance and official updates.',
        workers: 'Avoid outdoor work where possible and follow your employer\'s safety rules and official guidance. Check official updates before going out.',
        families: 'Stay indoors where possible and avoid unnecessary travel. People with breathing conditions should follow their doctor\'s advice, and official warnings come from the UAE National Center of Meteorology.',
      },
    },
  },

  howItWorks: {
    title: 'How DustWatch Works',
    subtitle: 'An open, student-built pipeline estimating short-term dust risk across the UAE.',
    flow: {
      step1Title: '1. Data In',
      step1Desc: 'Open-Meteo forecasts: hourly particulate matter (dust, PM10), wind speed, wind gusts, aerosol optical depth, humidity, and visibility for 10 UAE cities.',
      step2Title: '2. Risk Calculation',
      step2Desc: 'Straight-line scaling turns each factor into a 0-100 sub-score. Weighted averaging and a particle cap compute an hourly risk score from Low to Very High.',
      step3Title: '3. Confidence',
      step3Desc: 'Heuristics check data freshness, agreement between dust and PM10, borderline cutoffs, and missing variables to assign Low, Medium, or High confidence.',
      step4Title: '4. Plain Advice',
      step4Desc: 'Gemini AI reads only the computed risk facts to produce short, calm guidance tailored for schools, outdoor workers, and families.',
    },
    sourcesTitle: 'Data Sources and Transparency',
    sourcesDesc: 'DustWatch collects weather forecasts and atmospheric composition forecasts from the keyless Open-Meteo API. The air-quality data is itself a model-based forecast (derived from CAMS, Copernicus Atmosphere Monitoring Service), not an in-situ optical sensor measurement. Satellite observations from NASA Worldview are planned for visual cross-referencing in future versions and are not currently included in the numerical risk score.',
    provisionalNotice: 'All thresholds and weightings used in this prototype are provisional placeholders set by the project team. They have not been clinically or meteorologically validated.',
    predictsTitle: 'What DustWatch Predicts and What It Does Not',
    predictsItems: [
      {
        title: 'Estimates 12-hour general dust risk',
        desc: 'Identifies conditions favourable to rising or blowing dust (strong wind + high particulate forecasts).',
      },
      {
        title: 'NOT an official warning',
        desc: 'DustWatch is an experimental academic project. It does not replace official severe weather warnings issued by the UAE National Center of Meteorology (NCM).',
      },
      {
        title: 'NOT an exact measurement of airborne dust',
        desc: 'PM10 and PM2.5 instruments capture all suspended particulate matter, including sea spray, vehicle pollution, and construction dust.',
      },
      {
        title: 'NOT medical advice or health diagnosis',
        desc: 'Risk levels are environmental indicators. Individuals with asthma or respiratory conditions must always follow their physician\'s action plan.',
      },
    ],
    responsibleTitle: 'Responsible Project Principles',
    responsibleDesc: 'DustWatch requires no account, tracks no personal data, and accesses no device GPS. User actions select cities from a fixed UAE list. In weather safety, a missed dust event is far more dangerous than a cautious false alarm. For all safety-critical decisions, consult official bulletins at ncm.ae.',
    geminiTitle: 'What Gemini Does vs. What the Team Built',
    geminiDesc: 'The machine intelligence in DustWatch is strictly divided. The project team designed the UAE geographic grid, scoring formulas, particle cap rule, confidence rating heuristics, and evaluation tools. Gemini AI is used solely as a calm summariser to format the pre-calculated numbers into clear, accessible 2-sentence advice for schools, workers, and families.',
    eventDefTitle: 'Project Dust Event Definition',
  },

  accuracy: {
    title: 'Model Evaluation and Accuracy',
    subtitle: 'Transparent benchmarking against historical dust observations across the UAE.',
    eventDefHeader: 'How we define a dust event',
    outcomesTitle: 'Understanding the Four Evaluation Outcomes',
    outcomes: [
      {
        name: 'Hit',
        desc: 'Dust was predicted (level High or Very High) and a real dust event was observed. The forecast succeeded.',
        badge: 'Success',
      },
      {
        name: 'Miss',
        desc: 'A real dust event happened, but was not predicted. This is the most serious error in weather hazard protection.',
        badge: 'Critical Defect',
      },
      {
        name: 'False Alarm',
        desc: 'A dust event was predicted, but no event was observed. Creates mild disruption or over-caution.',
        badge: 'Over-prediction',
      },
      {
        name: 'Correct Negative',
        desc: 'No dust was predicted and no dust occurred. Conditions remained calm.',
        badge: 'Clean Baseline',
      },
    ],
    officialTitle: 'Official Benchmark Results',
    notYetEvaluatedTitle: 'Not yet evaluated',
    notYetEvaluatedDesc: 'DustWatch has not completed its formal multi-station historical validation against UAE meteorological station logs. To maintain scientific integrity, no simulated or fictional validation scores are presented here. Until full evaluation logs are completed, confidence is capped at Medium.',
    csvToolTitle: 'Team Tool: Check results from a CSV file',
    csvToolDesc: 'Evaluate model, baseline, or persistence performance against historical event logs. All processing runs entirely inside your browser; no files or data are uploaded.',
    csvUploadLabel: 'Select CSV File to Evaluate',
    csvDownloadTemplate: 'Download CSV template',
    csvCopyJson: 'Copy results as JSON',
    csvCopiedJson: 'Copied to clipboard!',
    tooFewEvents: 'Too few events for reliable conclusions (< 10 observed events).',
    accuracyCaveat: 'Note: Overall accuracy can be misleadingly high in rare-event datasets when clean days outnumber dust days.',
    limitationsTitle: 'Known Limitations',
    limitations: [
      'Dust storm events in the UAE are relatively rare and episodic, requiring multi-season datasets for statistical significance.',
      'PM10 and PM2.5 sensors count all airborne particles, including maritime aerosols, vehicle emissions, and construction debris.',
      'Air-quality data is an atmospheric model forecast (CAMS) rather than live optical ground truth.',
      'Thresholds and factor weights are provisional starting placeholders until calibrated against UAE NCM station records.',
      'Event classifications depend entirely on the operational threshold definition chosen by the evaluation team.',
      'DustWatch currently covers the United Arab Emirates only, using a 10-city reference grid.',
      'Satellite reflectance observations are planned for future versions but not currently scored.',
      'Past predictive accuracy under specific synoptic regimes (e.g. Shamal winds) may not generalize to convective summer dust events.',
      'This tool is strictly an experimental educational prototype and never constitutes an official government warning.',
    ],
  },

  testView: {
    title: 'DustWatch Internal Test View',
    subtitle: 'For development, testing, simulation, and verification only.',
    simulationTitle: 'Simulation Controls',
    simApiFail: 'Simulate API failure',
    simMissingDust: 'Simulate missing dust values',
    simOldData: 'Simulate old data (4 hours)',
    resetSimulations: 'Reset simulations to normal',
    snapshotTitle: 'Live Snapshots & Model Testing',
    saveSnapshot: 'Save live snapshot',
    loadSnapshot: 'Load snapshot (JSON)',
    loadModelFile: 'Load model file (JSON)',
    selfChecksTitle: 'Automated Diagnostic Self-Checks',
    runChecks: 'Run all self-checks',
    diagnosticsTitle: 'Selected City Diagnostics (Next 12 Hours)',
  },
};
