// The dashboard both pages share (Analyze: your own videos; Demo: the sample jump): the
// analysis progress, the calibration step and the results. pages/demo.js puts it into the page's
// <div id="dashboard"> before anything else runs, so the markup lives in one place.
export const DASHBOARD_HTML = `
    <!-- 2. Analysis progress -->
    <section class="container demo-progress" id="demo-progress" hidden aria-labelledby="progress-title">
      <h2 id="progress-title" tabindex="-1">Analyzing <span id="progress-source"></span></h2>
      <div class="analysis" id="analysis"></div>
      <div class="analysis__error" id="analysis-error" hidden>
        <p class="notice" role="alert"><span data-icon="info"></span><span id="analysis-error-text"></span></p>
        <button type="button" class="btn btn--primary btn--sm" id="analysis-retry">Try another video</button>
      </div>
      <button type="button" class="btn btn--quiet btn--sm analysis__cancel" id="analysis-cancel" hidden>Cancel</button>
    </section>

    <!-- 2b. Calibrate (real videos): click the tape on a still from the video -->
    <section class="container demo-calibrate" id="demo-calibrate" hidden aria-labelledby="cal-title"></section>

    <!-- 3. Results -->
    <section class="container demo-results" id="demo-results" hidden aria-labelledby="results-title">
      <div class="results__head">
        <h2 id="results-title" tabindex="-1">Results</h2>
        <div class="attempt-pick" id="attempt-pick" role="group" aria-label="Attempt"></div>
        <span class="demo-tag" id="results-tag">Demo data</span>
        <div class="results__actions">
          <button type="button" class="btn btn--quiet btn--sm" id="download-results" hidden>Download results</button>
          <button type="button" class="btn btn--quiet btn--sm" id="add-jump" hidden>Add another jump</button>
          <button type="button" class="btn btn--quiet btn--sm" id="start-over">Start over</button>
        </div>
      </div>
      <p class="results__session" id="session-summary" hidden></p>
      <p class="results__source" id="results-source"></p>
      <div class="jump-foul" id="jump-foul" hidden></div>
      <div class="jump-alert" id="jump-alert" hidden></div>
      <div class="scoreboard results__stats" id="results-stats"></div>
      <div class="real-checks" id="real-checks" hidden></div>

      <div class="tablist" role="tablist" aria-label="Result views" id="result-tabs">
        <button class="tab" role="tab" id="tab-playback" data-tab="playback" aria-controls="panel-playback" aria-selected="true">Playback</button>
        <button class="tab" role="tab" id="tab-charts" data-tab="charts" aria-controls="panel-charts" aria-selected="false">Charts</button>
        <button class="tab" role="tab" id="tab-moments" data-tab="moments" aria-controls="panel-moments" aria-selected="false">Key moments</button>
        <button class="tab" role="tab" id="tab-compare" data-tab="compare" aria-controls="panel-compare" aria-selected="false">Compare<span class="tab__more"> attempts</span></button>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-playback" aria-labelledby="tab-playback" tabindex="0">
        <div class="playback-layout">
          <div><div id="playback"></div><div id="playback-real" hidden></div></div>
          <div class="pb-readouts" role="group" aria-label="Values at the current frame">
            <h3>At this frame</h3>
            <div class="scoreboard" id="pb-readouts"></div>
          </div>
        </div>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-charts" aria-labelledby="tab-charts" tabindex="0" hidden>
        <div class="charts-grid" id="charts"></div>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-moments" aria-labelledby="tab-moments" tabindex="0" hidden>
        <div class="moments" id="moments"></div>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-compare" aria-labelledby="tab-compare" tabindex="0" hidden>
        <div class="compare" id="compare"></div>
      </div>
    </section>
`;
