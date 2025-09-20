const fs = require('fs');
const path = require('path');

// Simple test to check rule matching logic
function testRuleMatching() {
  console.log('🔍 Testing Rule Matching Logic with CSV Data...\n');
  
  try {
    // Read CSV files
    const attendanceData = readCSV('../AttendanceData.csv');
    const rulesData = readCSV('../rules.csv');
    
    console.log(`✅ Loaded ${attendanceData.length} attendance records`);
    console.log(`✅ Loaded ${rulesData.length} rules`);
    
    // Test specific problematic records from your screenshot
    const testMemberships = [
      'Junior Single - Pay As You Go',
      'Junior 5 Pack - Pay As You Go', 
      'limited Packs - Loyalty Only'
    ];
    
    console.log('\n🧪 Testing Rule Matching for Problematic Memberships:\n');
    
    for (const membership of testMemberships) {
      console.log(`\n📋 Testing: "${membership}"`);
      console.log('=' .repeat(80));
      
      // Check what rules exist for this membership
      const matchingRules = rulesData.filter(rule => {
        const attendanceAlias = String(rule.attendance_alias || '').trim();
        const packageName = String(rule.package_name || '').trim();
        return attendanceAlias === membership || packageName === membership;
      });
      
      console.log(`📊 Found ${matchingRules.length} rules with EXACT membership name match:`);
      matchingRules.forEach((rule, index) => {
        console.log(`   ${index + 1}. Rule: "${rule.rule_name || 'No name'}"`);
        console.log(`      - attendance_alias: "${rule.attendance_alias || 'Empty'}"`);
        console.log(`      - package_name: "${rule.package_name || 'Empty'}"`);
        console.log(`      - session_type: "${rule.session_type || 'Empty'}"`);
        console.log(`      - price: ${rule.price || 'Empty'}`);
        console.log(`      - unit_price: ${rule.unit_price || 'Empty'}`);
      });
      
      if (matchingRules.length === 0) {
        console.log(`❌ NO EXACT MATCH FOUND`);
        
        // Debug: Show all rules with similar names
        console.log('\n🔍 Debugging - All rules with SIMILAR names:');
        const similarRules = rulesData.filter(rule => {
          const attendanceAlias = String(rule.attendance_alias || '').toLowerCase();
          const packageName = String(rule.package_name || '').toLowerCase();
          const searchTerm = membership.toLowerCase();
          return attendanceAlias.includes(searchTerm) || 
                 packageName.includes(searchTerm) ||
                 searchTerm.includes(attendanceAlias) ||
                 searchTerm.includes(packageName);
        });
        
        if (similarRules.length > 0) {
          similarRules.forEach((rule, index) => {
            console.log(`   ${index + 1}. "${rule.rule_name || 'No name'}"`);
            console.log(`      - attendance_alias: "${rule.attendance_alias || 'Empty'}"`);
            console.log(`      - package_name: "${rule.package_name || 'Empty'}"`);
            console.log(`      - session_type: "${rule.session_type || 'Empty'}"`);
          });
        } else {
          console.log(`   No similar rules found either`);
        }
      }
    }
    
    // Show all unique membership names from attendance data
    console.log('\n📊 All unique membership names in attendance data:');
    const uniqueMemberships = [...new Set(attendanceData.map(a => a['Membership Name']).filter(Boolean))];
    uniqueMemberships.slice(0, 10).forEach((membership, index) => {
      console.log(`   ${index + 1}. "${membership}"`);
    });
    if (uniqueMemberships.length > 10) {
      console.log(`   ... and ${uniqueMemberships.length - 10} more`);
    }
    
    // Show all unique attendance_alias from rules
    console.log('\n📊 All unique attendance_alias in rules data:');
    const uniqueAliases = [...new Set(rulesData.map(r => r.attendance_alias).filter(Boolean))];
    uniqueAliases.slice(0, 10).forEach((alias, index) => {
      console.log(`   ${index + 1}. "${alias}"`);
    });
    if (uniqueAliases.length > 10) {
      console.log(`   ... and ${uniqueAliases.length - 10} more`);
    }
    
    console.log('\n🎯 Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Simple CSV reader
function readCSV(filePath) {
  try {
    const fullPath = path.resolve(__dirname, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
    
    return data;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Run the test
testRuleMatching();
