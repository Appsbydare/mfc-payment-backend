const { AttendanceVerificationService } = require('./dist/services/attendanceVerificationService');
const { GoogleSheetsService } = require('./dist/services/googleSheets');

async function testRuleMatching() {
  console.log('🔍 Testing Rule Matching Logic...\n');
  
  try {
    const googleSheetsService = new GoogleSheetsService();
    const attendanceService = new AttendanceVerificationService();
    
    // Load test data
    console.log('📊 Loading test data...');
    const [attendanceData, paymentData, rulesData] = await Promise.all([
      googleSheetsService.readSheet('AttendanceData'),
      googleSheetsService.readSheet('PaymentData'),
      googleSheetsService.readSheet('rules')
    ]);
    
    console.log(`✅ Loaded ${attendanceData.length} attendance records`);
    console.log(`✅ Loaded ${paymentData.length} payment records`);
    console.log(`✅ Loaded ${rulesData.length} rules`);
    
    // Test specific problematic records
    const testRecords = [
      { membership: 'Junior Single - Pay As You Go', customer: 'Kaia Attard' },
      { membership: 'Junior 5 Pack - Pay As You Go', customer: 'Nazar Tsurkin' },
      { membership: 'limited Packs - Loyalty Only', customer: 'Nazar Tsurkin' }
    ];
    
    console.log('\n🧪 Testing Rule Matching for Problematic Records:\n');
    
    for (const testRecord of testRecords) {
      console.log(`\n📋 Testing: "${testRecord.membership}" (Customer: ${testRecord.customer})`);
      console.log('=' .repeat(80));
      
      // Find attendance record
      const attendanceRecord = attendanceData.find(a => 
        a.Customer === testRecord.customer && 
        a['Membership Name'] === testRecord.membership
      );
      
      if (!attendanceRecord) {
        console.log(`❌ No attendance record found for ${testRecord.customer}`);
        continue;
      }
      
      console.log(`✅ Found attendance record: ${attendanceRecord['Event Starts At']}`);
      
      // Test session type classification
      const sessionType = attendanceService.classifySessionType(attendanceRecord['Offering Type Name'] || '');
      console.log(`📝 Session Type: "${sessionType}"`);
      console.log(`📝 Offering Type: "${attendanceRecord['Offering Type Name']}"`);
      
      // Test rule matching
      console.log('\n🔍 Testing Rule Matching:');
      
      // Check what rules exist for this membership
      const matchingRules = rulesData.filter(rule => {
        const attendanceAlias = String(rule.attendance_alias || '').trim();
        const packageName = String(rule.package_name || '').trim();
        return attendanceAlias === testRecord.membership || packageName === testRecord.membership;
      });
      
      console.log(`📊 Found ${matchingRules.length} rules with matching membership name:`);
      matchingRules.forEach((rule, index) => {
        console.log(`   ${index + 1}. Rule: "${rule.rule_name}"`);
        console.log(`      - attendance_alias: "${rule.attendance_alias}"`);
        console.log(`      - package_name: "${rule.package_name}"`);
        console.log(`      - session_type: "${rule.session_type}"`);
        console.log(`      - price: ${rule.price}`);
        console.log(`      - unit_price: ${rule.unit_price}`);
      });
      
      // Test the actual matching logic
      console.log('\n🎯 Testing Actual Matching Logic:');
      const matchedRule = attendanceService.findMatchingRuleExact(testRecord.membership, sessionType, rulesData);
      
      if (matchedRule) {
        console.log(`✅ RULE MATCHED: "${matchedRule.rule_name}"`);
        console.log(`   - Package Price: ${matchedRule.price}`);
        console.log(`   - Session Price: ${matchedRule.unit_price}`);
        console.log(`   - Session Type: ${matchedRule.session_type}`);
      } else {
        console.log(`❌ NO RULE MATCHED`);
        
        // Debug: Show all rules with similar names
        console.log('\n🔍 Debugging - All rules with similar names:');
        const similarRules = rulesData.filter(rule => {
          const attendanceAlias = String(rule.attendance_alias || '').toLowerCase();
          const packageName = String(rule.package_name || '').toLowerCase();
          const searchTerm = testRecord.membership.toLowerCase();
          return attendanceAlias.includes(searchTerm) || 
                 packageName.includes(searchTerm) ||
                 searchTerm.includes(attendanceAlias) ||
                 searchTerm.includes(packageName);
        });
        
        similarRules.forEach((rule, index) => {
          console.log(`   ${index + 1}. "${rule.rule_name}"`);
          console.log(`      - attendance_alias: "${rule.attendance_alias}"`);
          console.log(`      - package_name: "${rule.package_name}"`);
          console.log(`      - session_type: "${rule.session_type}"`);
        });
      }
    }
    
    console.log('\n🎯 Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testRuleMatching();
