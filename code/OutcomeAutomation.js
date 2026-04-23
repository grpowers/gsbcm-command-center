/**
 * Main function to settle picks.
 */
function updateAllOutcomes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = ['MLB', 'NBA', 'NHL', 'NFL'];
  
  tabs.forEach(sport => {
    let sheet = ss.getSheetByName(sport + " Picks Log");
    if (sheet) processSportLog(sheet, sport.toLowerCase());
  });
}

function processSportLog(sheet, sport) {
  const data = sheet.getDataRange().getValues();
  const apiPaths = {'mlb': 'baseball/mlb', 'nba': 'basketball/nba', 'nhl': 'hockey/nhl', 'nfl': 'football/nfl'};
  
  for (let i = 1; i < data.length; i++) {
    let outcome = data[i][8]; // Column I
    let pickStr = data[i][4].toString().trim();
    let noteStr = data[i][10] ? data[i][10].toString().toLowerCase() : ""; // Column K (Notes)
    
    if (outcome !== "" || pickStr === "") continue;
    
    let gameDateValue = data[i][0];
    if (!(gameDateValue instanceof Date)) continue; 

    let gameDate = Utilities.formatDate(gameDateValue, "GMT", "yyyyMMdd");
    let gameStr = data[i][2].toUpperCase(); 
    
    // Check Notes for "Game 2" flag
    let occurrenceToFind = noteStr.includes("game 2") ? 2 : 1;

    let url = `https://site.api.espn.com/apis/site/v2/sports/${apiPaths[sport]}/scoreboard?dates=${gameDate}`;
    
    try {
      let response = UrlFetchApp.fetch(url);
      let json = JSON.parse(response.getContentText());
      
      // Pass the explicit occurrence (1 or 2) to the finder
      let event = findEventFuzzy(json.events, gameStr, occurrenceToFind);
      
      if (event && event.status.type.completed) {
        let comp = event.competitions[0];
        let home = comp.competitors.find(c => c.homeAway === 'home');
        let away = comp.competitors.find(c => c.homeAway === 'away');
        
        let result = calculateResult(pickStr, home, away);
        if (result) {
          sheet.getRange(i + 1, 9).setValue(result);
          console.log(`SETTLED: ${gameStr} (${occurrenceToFind === 2 ? 'Game 2' : 'Game 1'}) | Result: ${result}`);
        }
      }
    } catch (e) {
      console.log(`Error Row ${i+1}: ${e}`);
    }
  }
}

/**
 * UPDATED ABBREVIATION MAP: Translates your sheet's shorthand to ESPN's API language.
 */
function findEventFuzzy(events, gameStr, occurrence) {
  let cleanedGame = gameStr.toUpperCase()
    // --- NBA SPECIFIC FIXES ---
    .replace('SAS', 'SA')   // San Antonio -> SA
    .replace('NOP', 'NO')   // New Orleans -> NO
    .replace('NYK', 'NY')   // New York -> NY
    .replace('GSW', 'GS')   // Golden State -> GS
    .replace('UTA', 'UT')   // Utah -> UT
    // --- NHL SPECIFIC FIXES ---
    .replace('TBL', 'TB')
    .replace('NJD', 'NJ')
    .replace('SJS', 'SJ')
    .replace('WPG', 'WIN')
    .replace('WAS', 'WSH')
    .replace('LAK', 'LA');

  let myTeams = cleanedGame.split(/[\s@]+/).filter(t => t !== 'AT' && t !== '');
  
  // Logic: Filter for ALL games that match your teams on this date
  let matchingEvents = events.filter(e => {
    let espnShort = e.shortName.toUpperCase();
    let espnFull = e.name.toUpperCase();
    
    // Every team in your 'cleanedGame' must exist in the ESPN short or full name
    return myTeams.every(team => espnShort.includes(team) || espnFull.includes(team));
  });

  // Return the specific occurrence (1st game, 2nd game, etc.)
  // We use [occurrence - 1] because arrays are 0-indexed
  return matchingEvents.length >= occurrence ? matchingEvents[occurrence - 1] : null;
}

/**
 * ANCHORED LOGIC: Prioritizes Letter+Number patterns for Totals.
 */
function calculateResult(pick, home, away) {
  const hScore = parseFloat(home.score);
  const aScore = parseFloat(away.score);
  const totalScore = hScore + aScore;
  const p = pick.toLowerCase().trim();

  // 1. ANCHORED TOTALS: Look for 'o' or 'u' immediately followed by a number (e.g., o6.5)
  let totalMatch = p.match(/([ou])(\d+\.?\d*)/);
  if (totalMatch) {
    const type = totalMatch[1]; // 'o' or 'u'
    const line = parseFloat(totalMatch[2]); // The number
    
    if (totalScore === line) return "Push";
    const won = (type === 'o') ? (totalScore > line) : (totalScore < line);
    return won ? "Win" : "Loss";
  }

  // 2. ANCHORED SPREADS: Look for team name + a +/- number
  let spreadMatch = p.match(/([+-]\d+\.?\d*)/);
  if (spreadMatch) {
    const spread = parseFloat(spreadMatch[0]);
    const isHome = p.includes(home.team.abbreviation.toLowerCase()) || p.includes(home.team.name.toLowerCase());
    
    const myScore = isHome ? hScore + spread : aScore + spread;
    const oppScore = isHome ? aScore : hScore;
    
    if (myScore === oppScore) return "Push";
    return myScore > oppScore ? "Win" : "Loss";
  }

  // 3. MONEYLINE: Fallback only if no O/U or Spread patterns found
  const winner = hScore > aScore ? home : away;
  const wAbbr = winner.team.abbreviation.toLowerCase();
  const wName = winner.team.name.toLowerCase();
  
  if (p.includes(wAbbr) || p.includes(wName)) return "Win";
  
  const loser = hScore > aScore ? away : home;
  const lAbbr = loser.team.abbreviation.toLowerCase();
  if (p.includes(lAbbr)) return "Loss";

  return null;
}