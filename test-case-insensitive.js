// Test case-insensitive matching
function testCaseInsensitiveMatching() {
  console.log('🔍 Testing Case-Insensitive Matching...\n');
  
  const testCases = [
    {
      attendance: "Junior Single - Pay As You Go",
      rules: "Junior Single - Pay as You Go",
      expected: true
    },
    {
      attendance: "Junior 5 Pack - Pay As You Go", 
      rules: "Junior 5 pack - Pay As You Go",
      expected: true
    },
    {
      attendance: "Adult Single - Pay As You Go",
      rules: "Adult Single - Pay as You Go", 
      expected: true
    }
  ];
  
  console.log('🧪 Test Cases:\n');
  
  testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}:`);
    console.log(`  Attendance: "${testCase.attendance}"`);
    console.log(`  Rules:      "${testCase.rules}"`);
    
    // Test case-sensitive matching (old way)
    const caseSensitiveMatch = testCase.attendance === testCase.rules;
    console.log(`  Case-sensitive match: ${caseSensitiveMatch ? '✅' : '❌'}`);
    
    // Test case-insensitive matching (new way)
    const caseInsensitiveMatch = testCase.attendance.toLowerCase().trim() === testCase.rules.toLowerCase().trim();
    console.log(`  Case-insensitive match: ${caseInsensitiveMatch ? '✅' : '❌'}`);
    
    console.log(`  Expected: ${testCase.expected ? '✅' : '❌'}`);
    console.log(`  Result: ${caseInsensitiveMatch === testCase.expected ? '✅ PASS' : '❌ FAIL'}\n`);
  });
  
  console.log('🎯 Case-insensitive matching should fix the "Package Cannot be found" issue!');
}

testCaseInsensitiveMatching();
