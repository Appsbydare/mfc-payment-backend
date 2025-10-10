"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attendanceVerificationService = exports.AttendanceVerificationService = void 0;
const googleSheets_1 = require("./googleSheets");
const invoiceVerificationService_1 = require("./invoiceVerificationService");
class AttendanceVerificationService {
    constructor() {
        this.MASTER_SHEET = 'payment_calc_detail';
        this.ATTENDANCE_SHEET = 'attendance';
        this.PAYMENTS_SHEET = 'Payments';
        this.RULES_SHEET = 'rules';
        this.DISCOUNTS_SHEET = 'discounts';
    }
    async verifyAttendanceData(params = {}) {
        const startTime = Date.now();
        let processedCount = 0;
        let errorCount = 0;
        try {
            console.log('🔄 Starting ENHANCED verification process with invoice tracking...');
            console.log(`📅 Date range: ${params.fromDate || 'all'} to ${params.toDate || 'all'}`);
            if (params.fromDate && params.toDate) {
                const fromDate = new Date(params.fromDate);
                const toDate = new Date(params.toDate);
                if (fromDate > toDate) {
                    throw new Error('Invalid date range: fromDate cannot be after toDate');
                }
            }
            console.log('📋 Step 1: Initializing invoice verification system...');
            let invoiceVerifications = [];
            try {
                invoiceVerifications = await invoiceVerificationService_1.invoiceVerificationService.loadInvoiceVerificationData();
                console.log(`📊 Loaded ${invoiceVerifications.length} existing invoice verification records`);
            }
            catch (error) {
                console.log('⚠️ Error loading invoice verification data:', error.message);
                invoiceVerifications = [];
            }
            if (invoiceVerifications.length === 0) {
                console.log('🆕 No existing invoice data found, initializing from payments...');
                try {
                    invoiceVerifications = await invoiceVerificationService_1.invoiceVerificationService.initializeInvoiceVerification();
                    await invoiceVerificationService_1.invoiceVerificationService.saveInvoiceVerificationData(invoiceVerifications);
                    console.log(`✅ Initialized ${invoiceVerifications.length} invoice verification records`);
                }
                catch (error) {
                    console.error('❌ Error initializing invoice verification:', error);
                    throw new Error(`Failed to initialize invoice verification: ${error?.message || 'Unknown error'}`);
                }
            }
            console.log(`📊 Loaded ${invoiceVerifications.length} invoice verification records`);
            console.log('📋 Step 2: Loading attendance, payments, rules, and discounts...');
            const { attendance, payments, rules, discounts } = await this.loadAllData();
            if (!attendance || attendance.length === 0) {
                throw new Error('No attendance data found');
            }
            if (!rules || rules.length === 0) {
                console.warn('⚠️ No rules data found - verification may not work properly');
            }
            const filteredAttendance = this.filterAttendanceByDate(attendance, params.fromDate, params.toDate);
            const filteredPayments = this.filterPaymentsByDate(payments, params.fromDate, params.toDate);
            console.log(`📊 Processing ${filteredAttendance.length} attendance records and ${filteredPayments.length} payment records`);
            if (filteredAttendance.length === 0) {
                console.log('📝 No attendance records found in the specified date range');
                return {
                    masterRows: [],
                    summary: {
                        totalRecords: 0,
                        verifiedRecords: 0,
                        unverifiedRecords: 0,
                        verificationRate: 0,
                        newRecordsAdded: 0
                    }
                };
            }
            console.log('📋 Step 3: Processing attendance records with invoice balance tracking...');
            const masterRows = [];
            for (const attendanceRecord of filteredAttendance) {
                try {
                    const { masterRow, updatedInvoices } = await this.processAttendanceRecordWithInvoiceTracking(attendanceRecord, filteredPayments, rules, discounts, invoiceVerifications);
                    masterRows.push(masterRow);
                    invoiceVerifications = updatedInvoices;
                    processedCount++;
                    console.log(`✅ Processed ${processedCount}/${filteredAttendance.length}: ${masterRow.customerName} - ${masterRow.verificationStatus}`);
                }
                catch (error) {
                    errorCount++;
                    console.error(`❌ Error processing record ${processedCount + 1}: ${error.message}`);
                    console.error(`   Customer: ${attendanceRecord.Customer}, Membership: ${attendanceRecord['Membership Name']}`);
                    const errorRow = {
                        customerName: attendanceRecord.Customer || 'Unknown',
                        eventStartsAt: attendanceRecord['Event Starts At'] || '',
                        membershipName: attendanceRecord['Membership Name'] || 'Unknown',
                        instructors: attendanceRecord.Instructors || '',
                        status: attendanceRecord.Status || '',
                        discount: '',
                        discountPercentage: 0,
                        verificationStatus: 'Package Cannot be found',
                        invoiceNumber: '',
                        amount: 0,
                        paymentDate: '',
                        packagePrice: 0,
                        sessionPrice: 0,
                        discountedSessionPrice: 0,
                        coachAmount: 0,
                        bgmAmount: 0,
                        managementAmount: 0,
                        mfcAmount: 0,
                        uniqueKey: this.generateUniqueKey(attendanceRecord),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    masterRows.push(errorRow);
                    processedCount++;
                }
            }
            console.log('📋 Step 4: Skipping discount application - use Add Discounts button separately...');
            const finalMasterRows = masterRows;
            console.log('📋 Step 5: Saving updated invoice verification data...');
            await invoiceVerificationService_1.invoiceVerificationService.saveInvoiceVerificationData(invoiceVerifications);
            if (!params.skipWrite) {
                console.log('📋 Step 6: Saving master verification data...');
                await this.saveMasterData(finalMasterRows);
            }
            else {
                console.log('📋 Step 6: Skipping save to database (batch mode)');
            }
            const summary = this.calculateSummary(finalMasterRows);
            const processingTime = Date.now() - startTime;
            console.log(`🎯 ENHANCED Verification complete: ${summary.verifiedRecords}/${summary.totalRecords} verified (${summary.verificationRate.toFixed(1)}%)`);
            console.log(`⏱️ Processing time: ${processingTime}ms`);
            console.log(`📊 Processed: ${processedCount} records, Errors: ${errorCount}`);
            return {
                masterRows: finalMasterRows,
                summary
            };
        }
        catch (error) {
            const processingTime = Date.now() - startTime;
            console.error('❌ Error in ENHANCED attendance verification:', error);
            console.error(`⏱️ Processing time before error: ${processingTime}ms`);
            console.error(`📊 Processed before error: ${processedCount} records, Errors: ${errorCount}`);
            throw new Error(`Attendance verification failed: ${error?.message || 'Unknown error'}`);
        }
    }
    async loadExistingMasterData() {
        try {
            console.log('📋 Loading existing master data from database...');
            const data = await googleSheets_1.googleSheetsService.readSheet(this.MASTER_SHEET);
            const masterData = data.map(row => this.normalizeMasterRow(row));
            console.log(`✅ Loaded ${masterData.length} existing master records`);
            return masterData;
        }
        catch (error) {
            console.log('📝 No existing master data found, starting fresh');
            return [];
        }
    }
    async clearMasterData() {
        try {
            console.log('🗑️ Clearing all master verification data...');
            await googleSheets_1.googleSheetsService.writeSheet(this.MASTER_SHEET, []);
            console.log('✅ Master verification data cleared successfully');
        }
        catch (error) {
            console.error('❌ Error clearing master data:', error);
            throw new Error(`Failed to clear master data: ${error?.message || 'Unknown error'}`);
        }
    }
    async batchVerificationProcess(params = {}) {
        const startTime = Date.now();
        console.log('🔄 Starting BATCH verification process (single write at end)...');
        try {
            console.log('📋 Step 1: Verifying payments (memory only)...');
            const verifyResult = await this.verifyAttendanceData({
                ...params,
                skipWrite: true
            });
            let masterData = verifyResult.masterRows;
            console.log(`✅ Step 1: Payment verification completed - ${masterData.length} records processed`);
            console.log('📋 Step 2: Applying discounts (memory only)...');
            const { payments, discounts } = await this.loadAllData();
            masterData = await this.applyDiscountsToMasterData(masterData, discounts, payments);
            const discountAppliedCount = masterData.filter(r => r.discount && r.discountPercentage > 0).length;
            console.log(`✅ Step 2: Discount application completed - ${discountAppliedCount} records with discounts`);
            console.log('📋 Step 3: Recalculating amounts (memory only)...');
            masterData = await this.recalculateDiscountedAmounts(masterData);
            const recalculatedCount = masterData.filter(r => r.discount && r.discountPercentage > 0).length;
            console.log(`✅ Step 3: Amount recalculation completed - ${recalculatedCount} records recalculated`);
            console.log('📋 Step 4: Writing final data to database...');
            await this.saveMasterData(masterData);
            console.log('✅ Step 4: Data written to database successfully');
            const summary = this.calculateSummary(masterData);
            const processingTime = Date.now() - startTime;
            console.log(`🎯 BATCH Verification complete: ${summary.verifiedRecords}/${summary.totalRecords} verified (${summary.verificationRate.toFixed(1)}%)`);
            console.log(`⏱️ Processing time: ${processingTime}ms`);
            console.log(`📊 Final: ${masterData.length} records, ${discountAppliedCount} with discounts`);
            return {
                masterRows: masterData,
                summary: {
                    ...summary,
                    newRecordsAdded: verifyResult.summary.newRecordsAdded
                }
            };
        }
        catch (error) {
            console.error('❌ Error in batch verification process:', error);
            throw new Error(`Batch verification failed: ${error?.message || 'Unknown error'}`);
        }
    }
    async loadExistingDataOnly() {
        try {
            console.log('📋 Loading existing data from database (read-only)...');
            const data = await googleSheets_1.googleSheetsService.readSheet(this.MASTER_SHEET);
            const masterData = data.map(row => this.normalizeMasterRow(row));
            console.log(`✅ Loaded ${masterData.length} existing records (read-only)`);
            return masterData;
        }
        catch (error) {
            console.log('📝 No existing data found');
            return [];
        }
    }
    async loadAllData() {
        const [attendance, payments, rawRules, discounts] = await Promise.all([
            googleSheets_1.googleSheetsService.readSheet(this.ATTENDANCE_SHEET).catch(() => []),
            googleSheets_1.googleSheetsService.readSheet(this.PAYMENTS_SHEET).catch(() => []),
            googleSheets_1.googleSheetsService.readSheet(this.RULES_SHEET).catch(() => []),
            googleSheets_1.googleSheetsService.readSheet(this.DISCOUNTS_SHEET).catch(() => [])
        ]);
        const normalizedRules = this.normalizeRules(rawRules);
        return { attendance, payments, rules: normalizedRules, discounts };
    }
    normalizeRules(rawRules) {
        if (!rawRules || rawRules.length === 0)
            return [];
        const toNum = (v, d = 0) => {
            const n = parseFloat(String(v).replace('%', ''));
            return isNaN(n) ? d : n;
        };
        return rawRules.map((r) => ({
            id: String(r.id || r.ID || '').trim() || '',
            rule_name: String(r.rule_name || r.name || r.rule || '').trim(),
            package_name: String(r.package_name || r.membership_name || r.name || '').trim(),
            session_type: (() => {
                const raw = String((r.session_type ?? r.category ?? '')).trim().toLowerCase();
                if (raw) {
                    if (/^priv/.test(raw))
                        return 'private';
                    if (/^group/.test(raw))
                        return 'group';
                }
                const privateFlag = String((r.privateSession ?? '')).toLowerCase();
                if (privateFlag === 'true' || privateFlag === '1')
                    return 'private';
                return 'group';
            })(),
            price: toNum(r.price),
            sessions: toNum(r.sessions),
            sessions_per_pack: toNum(r.sessions_per_pack || r.sessions),
            unit_price: toNum(r.unit_price, null),
            coach_percentage: toNum(r.coach_percentage || r.coachPct, null),
            bgm_percentage: toNum(r.bgm_percentage || r.bgmPct, null),
            management_percentage: toNum(r.management_percentage || r.mgmtPct, null),
            mfc_percentage: toNum(r.mfc_percentage || r.mfcPct, null),
            pricing_type: String(r.pricing_type || '').trim().toLowerCase(),
            per_week: toNum(r.per_week),
            fixed_rate: toNum(r.fixed_rate),
            match_offering_patterns: String(r.match_offering_patterns || '').trim(),
            allow_late_payment_window_days: String(r.allow_late_payment_window_days || '').trim(),
            is_fixed_rate: String(r.is_fixed_rate || r.fixed || '').trim(),
            allow_discounts: String(r.allow_discounts || r.allowDiscounts || '').trim(),
            notes: String(r.notes || '').trim(),
            attendance_alias: String(r.attendance_alias || r.attendanceAlias || '').trim(),
            payment_memo_alias: String(r.payment_memo_alias || r.paymentMemoAlias || '').trim(),
            created_at: r.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }));
    }
    async processAttendanceRecordWithInvoiceTracking(attendance, payments, rules, discounts, invoiceVerifications) {
        const customerName = this.getField(attendance, ['Customer Name', 'Customer']) || '';
        const eventStartsAt = this.getField(attendance, ['Event Starts At', 'EventStartAt', 'EventStart', 'Date']) || '';
        const membershipName = this.getField(attendance, ['Membership Name', 'Membership', 'MembershipName']) || '';
        const classType = this.getField(attendance, ['Class Type', 'ClassType', 'Offering Type Name']) || '';
        const instructors = this.getField(attendance, ['Instructors', 'Instructor']) || '';
        const status = this.getField(attendance, ['Status']) || '';
        console.log(`🔍 Processing: ${customerName} - ${membershipName}`);
        const matchingPayment = this.findMatchingPaymentDirect(customerName, membershipName, payments, rules);
        let verificationStatus;
        let invoiceNumber = '';
        let amount = 0;
        let paymentDate = '';
        let updatedInvoices = invoiceVerifications;
        if (matchingPayment) {
            console.log(`✅ Payment match found: Invoice=${matchingPayment.Invoice}, Amount=${matchingPayment.Amount}, Memo="${matchingPayment.Memo}"`);
            const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
            const rule = this.findMatchingRuleExact(membershipName, sessionType, rules);
            if (!rule) {
                console.log(`❌ Package cannot be found in rules: "${membershipName}" (${sessionType})`);
                verificationStatus = 'Package Cannot be found';
                const invoiceResult = await this.useInvoiceForSession(customerName, Number(matchingPayment.Amount || 0), attendance['Event Starts at'] || '', invoiceVerifications, payments, rules);
                updatedInvoices = invoiceResult.updatedInvoices;
                invoiceNumber = invoiceResult.usedInvoiceNumber;
                amount = invoiceResult.usedAmount;
                paymentDate = invoiceResult.usedPaymentDate;
                console.log(`📋 Package cannot be found but invoice tracking maintained: Invoice=${invoiceNumber}`);
            }
            else {
                console.log(`✅ Rule found: ${rule.rule_name} - Package Price: ${rule.price}, Session Price: ${rule.unit_price}`);
                verificationStatus = 'Verified';
                const invoiceResult = await this.useInvoiceForSession(customerName, Number(rule.unit_price || 0), attendance['Event Starts at'] || '', invoiceVerifications, payments, rules);
                updatedInvoices = invoiceResult.updatedInvoices;
                invoiceNumber = invoiceResult.usedInvoiceNumber;
                amount = invoiceResult.usedAmount;
                paymentDate = invoiceResult.usedPaymentDate;
            }
        }
        else {
            console.log(`❌ No payment match found for ${customerName} with membership "${membershipName}"`);
            verificationStatus = 'Not Verified';
        }
        const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
        let rule = null;
        let packagePrice = 0;
        let sessionPrice = 0;
        let amounts = {
            coach: 0,
            bgm: 0,
            management: 0,
            mfc: 0
        };
        if (verificationStatus === 'Verified') {
            rule = this.findMatchingRuleExact(membershipName, sessionType, rules);
            if (rule) {
                packagePrice = this.round2(Number(rule.price || 0));
                sessionPrice = this.round2(Number(rule.unit_price || 0));
                const discountedSessionPrice = sessionPrice;
                amounts = this.calculateAmounts(discountedSessionPrice, rule, sessionType);
            }
            else {
                console.log(`⚠️ Rule not found for calculations, setting all amounts to 0`);
                packagePrice = 0;
                sessionPrice = 0;
                amounts = { coach: 0, bgm: 0, management: 0, mfc: 0 };
            }
        }
        else {
            console.log(`⚠️ Verification status is "${verificationStatus}", setting all amounts to 0`);
            packagePrice = 0;
            sessionPrice = 0;
            amounts = { coach: 0, bgm: 0, management: 0, mfc: 0 };
        }
        const discountedSessionPrice = sessionPrice;
        const uniqueKey = this.generateUniqueKey(attendance);
        console.log(`🎯 FINAL VALUES: Session Price=${sessionPrice}, Package Price=${packagePrice}, Verification Status=${verificationStatus}, Invoice=${invoiceNumber}`);
        const masterRow = {
            customerName,
            eventStartsAt,
            membershipName,
            classType,
            instructors,
            status,
            discount: '',
            discountPercentage: 0,
            verificationStatus,
            invoiceNumber,
            amount,
            paymentDate,
            packagePrice,
            sessionPrice,
            discountedSessionPrice,
            coachAmount: this.round2(amounts.coach),
            bgmAmount: this.round2(amounts.bgm),
            managementAmount: this.round2(amounts.management),
            mfcAmount: this.round2(amounts.mfc),
            uniqueKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        return { masterRow, updatedInvoices };
    }
    findMatchingPaymentDirect(customerName, membershipName, payments, rules) {
        const normalizedCustomer = this.normalizeCustomerName(customerName);
        const normalizedMembership = membershipName.toLowerCase().trim();
        console.log(`🔍 Looking for payment match: Customer="${normalizedCustomer}", Membership="${normalizedMembership}"`);
        const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === normalizedCustomer);
        console.log(`📊 Found ${customerPayments.length} payments for customer "${normalizedCustomer}"`);
        const matchingRule = this.findMatchingRuleByAttendanceAlias(membershipName, rules);
        if (matchingRule && matchingRule.payment_memo_alias) {
            const paymentMemoAlias = String(matchingRule.payment_memo_alias).toLowerCase().trim();
            console.log(`📋 Found rule with payment_memo_alias: "${paymentMemoAlias}"`);
            for (const payment of customerPayments) {
                const memo = String(payment.Memo || '').toLowerCase().trim();
                if (memo === paymentMemoAlias) {
                    console.log(`✅ EXACT Payment match found using payment_memo_alias: Invoice=${payment.Invoice}, Amount=${payment.Amount}, Memo="${payment.Memo}"`);
                    return payment;
                }
            }
            for (const payment of customerPayments) {
                const memo = String(payment.Memo || '').toLowerCase().trim();
                if (memo.includes(paymentMemoAlias) || paymentMemoAlias.includes(memo)) {
                    console.log(`✅ PARTIAL Payment match found using payment_memo_alias: Invoice=${payment.Invoice}, Amount=${payment.Amount}, Memo="${payment.Memo}"`);
                    return payment;
                }
            }
        }
        for (const payment of customerPayments) {
            const memo = String(payment.Memo || '').toLowerCase().trim();
            if (memo === normalizedMembership) {
                console.log(`✅ EXACT Payment match found: Invoice=${payment.Invoice}, Amount=${payment.Amount}, Memo="${payment.Memo}"`);
                return payment;
            }
        }
        for (const payment of customerPayments) {
            const memo = String(payment.Memo || '').toLowerCase().trim();
            if (memo.includes(normalizedMembership) || normalizedMembership.includes(memo)) {
                console.log(`✅ PARTIAL Payment match found: Invoice=${payment.Invoice}, Amount=${payment.Amount}, Memo="${payment.Memo}"`);
                return payment;
            }
        }
        console.log(`❌ No payment match found for customer "${normalizedCustomer}" with membership "${normalizedMembership}"`);
        return null;
    }
    findMatchingPaymentNew(attendance, payments) {
        const customerName = this.normalizeCustomerName(attendance.Customer);
        const membershipName = attendance['Membership Name'] || '';
        console.log(`🔍 Looking for payment match: Customer="${customerName}", Membership="${membershipName}"`);
        const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === customerName);
        console.log(`📊 Found ${customerPayments.length} payments for customer "${customerName}"`);
        for (const payment of customerPayments) {
            const memo = String(payment.Memo || '').toLowerCase();
            const membership = membershipName.toLowerCase();
            if (memo.includes(membership) || membership.includes(memo)) {
                console.log(`✅ Payment match found: Invoice=${payment.Invoice}, Amount=${payment.Amount}, Memo="${payment.Memo}"`);
                return payment;
            }
        }
        console.log(`❌ No payment match found for customer "${customerName}" with membership "${membershipName}"`);
        return null;
    }
    findMatchingPayment(attendance, payments, rules = []) {
        const customerName = this.normalizeCustomerName(attendance.Customer);
        const membershipName = this.normalizeMembershipName(attendance['Membership Name']);
        const attendanceDate = this.parseDate(attendance['Event Starts At'] || attendance.Date || '');
        if (!attendanceDate)
            return null;
        const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === customerName);
        let best = null;
        const memTokens = this.tokenize(membershipName);
        const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
        const relevantRules = rules.filter(r => r.session_type === sessionType);
        const paymentAliases = relevantRules
            .map(r => String(r.payment_memo_alias || '').trim())
            .filter(alias => alias.length > 0);
        for (const p of customerPayments) {
            const pd = this.parseDate(p.Date);
            if (!pd)
                continue;
            const sameDay = this.isSameDate(attendanceDate, pd) ? 1 : 0;
            const within7 = this.isWithinDays(attendanceDate, pd, 7) ? 0.7 : 0;
            const memo = String(p.Memo || '');
            let textScore = 0;
            for (const alias of paymentAliases) {
                if (this.canonicalize(alias) === this.canonicalize(memo)) {
                    textScore = 2.0;
                    break;
                }
            }
            if (textScore === 0) {
                for (const alias of paymentAliases) {
                    if (this.fuzzyContains(alias, memo)) {
                        textScore = 1.8;
                        break;
                    }
                }
                if (textScore === 0) {
                    textScore = this.fuzzyContains(membershipName, memo) ? 1.5 : this.jaccard(memTokens, this.tokenize(memo));
                }
            }
            const score = Math.max(sameDay, within7) + textScore;
            if (!best || score > best.score)
                best = { p, score };
        }
        if (best && best.score >= 1.1)
            return best.p;
        return null;
    }
    async findApplicableDiscount(payment, discounts) {
        if (!payment)
            return null;
        const memo = String(payment.Memo || '');
        const amount = parseFloat(String(payment.Amount || '0')) || 0;
        for (const discount of discounts) {
            if (discount && discount.active && discount.discount_code) {
                if (memo.toLowerCase().includes(String(discount.discount_code).toLowerCase())) {
                    return discount;
                }
            }
        }
        if (memo.toLowerCase().includes('discount') || amount < 0) {
            return discounts.find(d => d.discount_code === 'discount') || null;
        }
        return null;
    }
    calculateDiscountedSessionPrice(params) {
        const { rule, discountInfo } = params;
        let price = 0;
        if (rule && rule.unit_price !== null && rule.unit_price !== undefined && rule.unit_price > 0) {
            price = Number(rule.unit_price);
            console.log(`✅ Using exact unit_price from database: ${price}`);
        }
        else {
            price = Number(params.baseAmount || 0);
            console.log(`⚠️ No unit_price in rule, using payment amount: ${price}`);
        }
        if (!discountInfo)
            return price;
        const pct = Number(discountInfo.applicable_percentage || 0);
        const type = String(discountInfo.coach_payment_type || 'partial').toLowerCase();
        if (type === 'free')
            return 0;
        if (type === 'full')
            return price;
        if (type === 'partial' && pct > 0) {
            return price * (1 - pct / 100);
        }
        return price;
    }
    calculateAmounts(sessionPrice, rule, sessionType) {
        if (!rule) {
            const defaults = sessionType === 'private'
                ? { coach: 80, bgm: 15, management: 0, mfc: 5 }
                : { coach: 43.5, bgm: 30, management: 8.5, mfc: 18 };
            return {
                coach: (sessionPrice * defaults.coach) / 100,
                bgm: (sessionPrice * defaults.bgm) / 100,
                management: (sessionPrice * defaults.management) / 100,
                mfc: (sessionPrice * defaults.mfc) / 100
            };
        }
        return {
            coach: (sessionPrice * rule.coach_percentage) / 100,
            bgm: (sessionPrice * rule.bgm_percentage) / 100,
            management: (sessionPrice * rule.management_percentage) / 100,
            mfc: (sessionPrice * rule.mfc_percentage) / 100
        };
    }
    async useInvoiceForSession(customerName, sessionPrice, sessionDate, invoiceVerifications, payments, rules) {
        console.log(`💰 Finding appropriate invoice for session (${sessionPrice}) on ${sessionDate} for customer ${customerName}`);
        const bestInvoice = await this.findBestAvailableInvoice(customerName, sessionPrice, sessionDate, invoiceVerifications, payments, rules);
        if (!bestInvoice) {
            console.log(`❌ No available invoice found for customer ${customerName}, trying fallback approach`);
            const normalizedCustomer = this.normalizeCustomerName(customerName);
            const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === normalizedCustomer);
            if (customerPayments.length > 0) {
                const fallbackPayment = customerPayments[0];
                console.log(`🔄 Using fallback payment: Invoice ${fallbackPayment.Invoice}`);
                return {
                    updatedInvoices: invoiceVerifications,
                    usedInvoiceNumber: fallbackPayment.Invoice,
                    usedAmount: Number(fallbackPayment.Amount || 0),
                    usedPaymentDate: fallbackPayment.Date
                };
            }
            return {
                updatedInvoices: invoiceVerifications,
                usedInvoiceNumber: '',
                usedAmount: 0,
                usedPaymentDate: ''
            };
        }
        console.log(`✅ Using invoice ${bestInvoice.invoiceNumber} for session`);
        const newUsedAmount = this.round2(bestInvoice.usedAmount + sessionPrice);
        const newRemainingBalance = this.round2(bestInvoice.remainingBalance - sessionPrice);
        const newSessionsUsed = bestInvoice.sessionsUsed + 1;
        let newStatus = 'Available';
        if (newRemainingBalance <= 0) {
            newStatus = 'Fully Used';
        }
        else if (newUsedAmount > 0) {
            newStatus = 'Partially Used';
        }
        const updatedInvoices = invoiceVerifications.map(inv => {
            if (inv.invoiceNumber === bestInvoice.invoiceNumber) {
                return {
                    ...inv,
                    usedAmount: newUsedAmount,
                    remainingBalance: newRemainingBalance,
                    sessionsUsed: newSessionsUsed,
                    status: newStatus,
                    lastUsedDate: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }
            return inv;
        });
        const paymentRecord = payments.find(p => p.Invoice === bestInvoice.invoiceNumber);
        const usedAmount = paymentRecord ? Number(paymentRecord.Amount || 0) : 0;
        const usedPaymentDate = paymentRecord ? paymentRecord.Date : '';
        console.log(`✅ Updated invoice ${bestInvoice.invoiceNumber}: Sessions ${newSessionsUsed}/${bestInvoice.totalSessions}, Balance: ${newRemainingBalance}`);
        return {
            updatedInvoices,
            usedInvoiceNumber: bestInvoice.invoiceNumber,
            usedAmount,
            usedPaymentDate
        };
    }
    async findBestAvailableInvoice(customerName, requiredAmount, sessionDate, invoiceVerifications, payments, rules) {
        const normalizedCustomer = this.normalizeCustomerName(customerName);
        console.log(`🔍 Finding best invoice for ${normalizedCustomer}, required amount: ${requiredAmount}`);
        await this.ensureAllInvoicesInVerification(normalizedCustomer, invoiceVerifications, payments, rules);
        const customerInvoices = invoiceVerifications.filter(invoice => invoice.customerName === normalizedCustomer);
        console.log(`📊 Customer ${normalizedCustomer} has ${customerInvoices.length} invoices: ${customerInvoices.map(inv => `${inv.invoiceNumber}(${inv.remainingBalance}/${inv.totalAmount})`).join(', ')}`);
        const availableInvoices = customerInvoices.filter(invoice => invoice.remainingBalance >= requiredAmount &&
            invoice.status !== 'Fully Used');
        console.log(`💰 Available invoices with sufficient balance (>=${requiredAmount}): ${availableInvoices.length}`);
        if (availableInvoices.length === 0) {
            console.log(`❌ No available invoices found for customer ${normalizedCustomer} with sufficient balance`);
            return null;
        }
        const sortedInvoices = availableInvoices.sort((a, b) => {
            const paymentA = payments.find(p => p.Invoice === a.invoiceNumber);
            const paymentB = payments.find(p => p.Invoice === b.invoiceNumber);
            if (!paymentA || !paymentB)
                return 0;
            const dateA = new Date(paymentA.Date);
            const dateB = new Date(paymentB.Date);
            return dateA.getTime() - dateB.getTime();
        });
        console.log(`📋 Sorted available invoices for ${normalizedCustomer}: ${sortedInvoices.map(inv => `${inv.invoiceNumber}(${inv.remainingBalance})`).join(', ')}`);
        const selectedInvoice = sortedInvoices[0];
        console.log(`✅ Selected invoice ${selectedInvoice.invoiceNumber} (oldest available)`);
        return selectedInvoice;
    }
    async ensureAllInvoicesInVerification(customerName, invoiceVerifications, payments, rules) {
        const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === customerName);
        const existingInvoiceNumbers = new Set(invoiceVerifications.map(inv => inv.invoiceNumber));
        for (const payment of customerPayments) {
            if (!existingInvoiceNumbers.has(payment.Invoice)) {
                console.log(`🆕 Adding missing invoice to verification: ${payment.Invoice}`);
                const newInvoice = {
                    invoiceNumber: payment.Invoice,
                    customerName: customerName,
                    totalAmount: Number(payment.Amount || 0),
                    usedAmount: 0,
                    remainingBalance: Number(payment.Amount || 0),
                    status: 'Available',
                    sessionsUsed: 0,
                    totalSessions: 0,
                    lastUsedDate: '',
                    createdAt: payment.Date,
                    updatedAt: new Date().toISOString()
                };
                const memo = String(payment.Memo || '').toLowerCase();
                const sessionPrice = this.estimateSessionPriceFromRules(rules, memo);
                if (sessionPrice > 0 && newInvoice.totalAmount > 0) {
                    newInvoice.totalSessions = Math.round(newInvoice.totalAmount / sessionPrice);
                }
                invoiceVerifications.push(newInvoice);
            }
        }
    }
    estimateSessionPriceFromRules(rules, memo) {
        if (!rules || rules.length === 0 || !memo)
            return 0;
        for (const rule of rules) {
            const packageName = String(rule.package_name || '').toLowerCase();
            const attendanceAlias = String(rule.attendance_alias || '').toLowerCase();
            const paymentMemoAlias = String(rule.payment_memo_alias || '').toLowerCase();
            const unitPrice = Number(rule.unit_price || 0);
            if (unitPrice > 0 && (memo.includes(packageName) ||
                memo.includes(attendanceAlias) ||
                memo.includes(paymentMemoAlias))) {
                return unitPrice;
            }
        }
        const validPrices = rules
            .map(r => Number(r.unit_price || 0))
            .filter(p => p > 0);
        if (validPrices.length > 0) {
            return validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length;
        }
        return 0;
    }
    findMatchingRuleByAttendanceAlias(membershipName, rules) {
        if (!rules || rules.length === 0)
            return null;
        console.log(`🔍 Looking for rule by attendance_alias: "${membershipName}"`);
        const normalizedMembership = membershipName.toLowerCase().trim();
        for (const r of rules) {
            const attendanceAlias = String(r.attendance_alias || '').trim().toLowerCase();
            if (attendanceAlias && attendanceAlias === normalizedMembership) {
                console.log(`✅ EXACT attendance_alias match: "${r.attendance_alias}" = "${membershipName}"`);
                return r;
            }
        }
        for (const r of rules) {
            const packageName = String(r.package_name || '').trim().toLowerCase();
            if (packageName && packageName === normalizedMembership) {
                console.log(`✅ EXACT package_name match: "${r.package_name}" = "${membershipName}"`);
                return r;
            }
        }
        console.log(`❌ NO EXACT MATCH found for "${membershipName}"`);
        return null;
    }
    findMatchingRuleExact(membershipName, sessionType, rules) {
        if (!rules || rules.length === 0)
            return null;
        console.log(`🔍 Looking for rule match: "${membershipName}" (${sessionType})`);
        let rule = this.findRuleByMembershipAndSessionType(membershipName, sessionType, rules);
        if (rule) {
            console.log(`✅ Found rule with session type match: "${rule.rule_name}"`);
            return rule;
        }
        console.log(`⚠️ No match with session type "${sessionType}", trying without session type restriction`);
        rule = this.findRuleByMembershipOnly(membershipName, rules);
        if (rule) {
            console.log(`✅ Found rule without session type restriction: "${rule.rule_name}"`);
            return rule;
        }
        console.log(`❌ NO MATCH found for "${membershipName}" (${sessionType})`);
        return null;
    }
    findRuleByMembershipAndSessionType(membershipName, sessionType, rules) {
        const normalizedMembership = membershipName.toLowerCase().trim();
        for (const r of rules) {
            if (r.session_type !== sessionType)
                continue;
            const attendanceAlias = String(r.attendance_alias || '').trim().toLowerCase();
            if (attendanceAlias && attendanceAlias === normalizedMembership) {
                console.log(`✅ EXACT attendance_alias match: "${r.attendance_alias}" = "${membershipName}" (${sessionType})`);
                return r;
            }
        }
        for (const r of rules) {
            if (r.session_type !== sessionType)
                continue;
            const packageName = String(r.package_name || '').trim().toLowerCase();
            if (packageName && packageName === normalizedMembership) {
                console.log(`✅ EXACT package_name match: "${r.package_name}" = "${membershipName}" (${sessionType})`);
                return r;
            }
        }
        return null;
    }
    findRuleByMembershipOnly(membershipName, rules) {
        const normalizedMembership = membershipName.toLowerCase().trim();
        for (const r of rules) {
            const attendanceAlias = String(r.attendance_alias || '').trim().toLowerCase();
            if (attendanceAlias && attendanceAlias === normalizedMembership) {
                console.log(`✅ EXACT attendance_alias match (no session type): "${r.attendance_alias}" = "${membershipName}"`);
                return r;
            }
        }
        for (const r of rules) {
            const packageName = String(r.package_name || '').trim().toLowerCase();
            if (packageName && packageName === normalizedMembership) {
                console.log(`✅ EXACT package_name match (no session type): "${r.package_name}" = "${membershipName}"`);
                return r;
            }
        }
        return null;
    }
    findMatchingRule(membershipName, sessionType, rules) {
        if (!rules || rules.length === 0)
            return null;
        const canonMembership = this.canonicalize(membershipName);
        console.log(`🔍 Looking for rule: "${membershipName}" (${sessionType})`);
        console.log(`📋 Available rules for ${sessionType}:`, rules.filter(r => r.session_type === sessionType).map(r => ({
            id: r.id,
            rule_name: r.rule_name,
            package_name: r.package_name,
            attendance_alias: r.attendance_alias || '(empty)',
            unit_price: r.unit_price,
            price: r.price
        })));
        for (const r of rules) {
            if (r.session_type !== sessionType)
                continue;
            const attendanceAlias = String(r.attendance_alias || '').trim();
            if (attendanceAlias && this.canonicalize(attendanceAlias) === this.canonicalize(membershipName)) {
                console.log(`✅ EXACT attendance_alias match: "${attendanceAlias}" = "${membershipName}"`);
                console.log(`📊 Rule details: unit_price=${r.unit_price}, price=${r.price}, sessions=${r.sessions}`);
                return r;
            }
        }
        console.log(`⚠️ No attendance_alias matches found for "${membershipName}"`);
        for (const r of rules) {
            if (r.session_type !== sessionType)
                continue;
            const packageName = String(r.package_name || '').trim();
            if (packageName && this.canonicalize(packageName) === this.canonicalize(membershipName)) {
                console.log(`✅ EXACT package_name match: "${packageName}" = "${membershipName}"`);
                console.log(`📊 Rule details: unit_price=${r.unit_price}, price=${r.price}, sessions=${r.sessions}`);
                return r;
            }
        }
        console.log(`⚠️ No exact package_name matches found for "${membershipName}"`);
        let best = null;
        const memTokens = this.tokenize(canonMembership);
        for (const r of rules) {
            if (r.session_type !== sessionType)
                continue;
            const attendanceAlias = String(r.attendance_alias || '').trim();
            const packageName = String(r.package_name || '').trim();
            let score = 0;
            if (attendanceAlias) {
                if (this.fuzzyContains(attendanceAlias, membershipName)) {
                    score = 2.0;
                }
                else {
                    score = this.jaccard(memTokens, this.tokenize(attendanceAlias)) * 1.5;
                }
            }
            else if (packageName) {
                if (this.fuzzyContains(packageName, membershipName)) {
                    score = 1.5;
                }
                else {
                    score = this.jaccard(memTokens, this.tokenize(packageName));
                }
            }
            if (score > 0 && (!best || score > best.score)) {
                best = { r, score };
            }
        }
        if (best && best.score >= 0.5) {
            console.log(`✅ FUZZY match found: score ${best.score.toFixed(2)} for "${membershipName}"`);
            console.log(`📊 Rule details: unit_price=${best.r.unit_price}, price=${best.r.price}, sessions=${best.r.sessions}`);
            return best.r;
        }
        const def = rules.find(r => (!r.package_name || r.package_name === '') && r.session_type === sessionType);
        if (def) {
            console.log(`⚠️ Using default rule for session type: ${sessionType}`);
            console.log(`📊 Default rule details: unit_price=${def.unit_price}, price=${def.price}, sessions=${def.sessions}`);
        }
        else {
            console.log(`❌ No rule found for "${membershipName}" (${sessionType})`);
            console.log(`🔍 All available rules:`, rules.map(r => ({
                id: r.id,
                rule_name: r.rule_name,
                package_name: r.package_name,
                session_type: r.session_type,
                unit_price: r.unit_price,
                price: r.price
            })));
        }
        return def || null;
    }
    classifySessionType(offeringType) {
        const type = String(offeringType || '').toLowerCase();
        if (type.includes('private') || type.includes('1 to 1') || type.includes('1-to-1')) {
            return 'private';
        }
        return 'group';
    }
    generateUniqueKey(attendance) {
        const date = attendance['Event Starts At'] || attendance.Date || '';
        const customer = attendance.Customer || '';
        const membership = attendance['Membership Name'] || '';
        const instructors = attendance.Instructors || '';
        const status = attendance.Status || '';
        const classType = attendance['Class Type'] || attendance.ClassType || attendance['Offering Type Name'] || '';
        const baseKey = `${date}_${customer}_${membership}_${instructors}_${status}_${classType}`;
        return baseKey.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    }
    normalizeMasterRow(row) {
        const sessionPrice = parseFloat(row.sessionPrice || row['Session Price'] || '0');
        const discountPercentage = parseFloat(row.discountPercentage || row['Discount %'] || '0');
        let discountedSessionPrice = parseFloat(row.discountedSessionPrice || row['Discounted Session Price'] || '0');
        if (discountedSessionPrice === 0 && sessionPrice > 0) {
            const factor = 1 - (discountPercentage / 100);
            discountedSessionPrice = this.round2(sessionPrice * factor);
        }
        return {
            customerName: row.customerName || row['Customer Name'] || '',
            eventStartsAt: row.eventStartsAt || row['Event Starts At'] || '',
            membershipName: row.membershipName || row['Membership Name'] || '',
            classType: row.classType || row['Class Type'] || row['ClassType'] || '',
            instructors: row.instructors || row['Instructors'] || '',
            status: row.status || row['Status'] || '',
            discount: row.discount || row['Discount'] || '',
            discountPercentage,
            verificationStatus: row.verificationStatus || row['Verification Status'] || 'Not Verified',
            invoiceNumber: row.invoiceNumber || row['Invoice #'] || '',
            amount: parseFloat(row.amount || row['Amount'] || '0'),
            paymentDate: row.paymentDate || row['Payment Date'] || '',
            packagePrice: parseFloat(row.packagePrice || row['Package Price'] || '0'),
            sessionPrice,
            discountedSessionPrice,
            coachAmount: parseFloat(row.coachAmount || row['Coach Amount'] || '0'),
            bgmAmount: parseFloat(row.bgmAmount || row['BGM Amount'] || '0'),
            managementAmount: parseFloat(row.managementAmount || row['Management Amount'] || '0'),
            mfcAmount: parseFloat(row.mfcAmount || row['MFC Amount'] || '0'),
            uniqueKey: row.uniqueKey || row['UniqueKey'] || this.generateUniqueKey({
                'Event Starts At': row.eventStartsAt || row['Event Starts At'] || '',
                'Customer': row.customerName || row['Customer Name'] || '',
                'Membership Name': row.membershipName || row['Membership Name'] || '',
                'Instructors': row.instructors || row['Instructors'] || ''
            }),
            createdAt: row.createdAt || '',
            updatedAt: row.updatedAt || ''
        };
    }
    getField(obj, keys) {
        if (!obj)
            return '';
        for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
                const v = obj[k];
                if (v !== undefined && v !== null && String(v).trim() !== '')
                    return String(v);
            }
            const foundKey = Object.keys(obj).find(kk => kk.toLowerCase().trim() === k.toLowerCase().trim());
            if (foundKey) {
                const v = obj[foundKey];
                if (v !== undefined && v !== null && String(v).trim() !== '')
                    return String(v);
            }
        }
        return '';
    }
    stripDiacritics(value) {
        return (value && value.normalize) ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value;
    }
    canonicalize(value) {
        const lower = this.stripDiacritics(String(value || '').toLowerCase());
        let cleaned = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        cleaned = cleaned
            .replace(/pack(s)?/g, 'pack')
            .replace(/x\s*(per\s*)?week/g, 'xweek')
            .replace(/per\s*week/g, 'xweek')
            .replace(/monthly|month(ly)?/g, 'monthly')
            .replace(/single\s*(session)?|payg|day\s*pass/g, 'single')
            .replace(/adult|junior|youth|plan|loyalty|only/g, ' ')
            .replace(/\s+/g, ' ').trim();
        return cleaned;
    }
    tokenize(value) {
        const canon = this.canonicalize(value);
        return new Set(canon.split(' ').filter(Boolean));
    }
    jaccard(a, b) {
        if (a.size === 0 && b.size === 0)
            return 1;
        let inter = 0;
        a.forEach(t => { if (b.has(t))
            inter++; });
        const union = a.size + b.size - inter;
        return union === 0 ? 0 : inter / union;
    }
    fuzzyContains(a, b) {
        const ca = this.canonicalize(a);
        const cb = this.canonicalize(b);
        return ca.includes(cb) || cb.includes(ca);
    }
    async saveMasterData(rows) {
        const dataObjects = rows.map(row => ({
            'Customer Name': row.customerName,
            'Event Starts At': row.eventStartsAt,
            'Membership Name': row.membershipName,
            'Class Type': row.classType,
            'Instructors': row.instructors,
            'Status': row.status,
            'Discount': row.discount,
            'Discount %': row.discountPercentage,
            'Verification Status': row.verificationStatus,
            'Invoice #': row.invoiceNumber,
            'Amount': row.amount,
            'Payment Date': row.paymentDate,
            'Package Price': row.packagePrice,
            'Session Price': row.sessionPrice,
            'Discounted Session Price': row.discountedSessionPrice,
            'Coach Amount': row.coachAmount,
            'BGM Amount': row.bgmAmount,
            'Management Amount': row.managementAmount,
            'MFC Amount': row.mfcAmount,
            'UniqueKey': row.uniqueKey,
            'CreatedAt': row.createdAt,
            'UpdatedAt': row.updatedAt
        }));
        await googleSheets_1.googleSheetsService.writeSheet(this.MASTER_SHEET, dataObjects);
    }
    calculateSummary(rows) {
        const totalRecords = rows.length;
        const verifiedRecords = rows.filter(r => r.verificationStatus === 'Verified').length;
        const unverifiedRecords = totalRecords - verifiedRecords;
        const verificationRate = totalRecords > 0 ? (verifiedRecords / totalRecords) * 100 : 0;
        return {
            totalRecords,
            verifiedRecords,
            unverifiedRecords,
            verificationRate,
            newRecordsAdded: 0
        };
    }
    normalizeCustomerName(name) {
        return String(name || '').toLowerCase().trim();
    }
    normalizeMembershipName(name) {
        return String(name || '').toLowerCase().trim();
    }
    parseDate(dateStr) {
        if (!dateStr)
            return null;
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date;
    }
    isSameDate(date1, date2) {
        return date1.toDateString() === date2.toDateString();
    }
    isWithinDays(date1, date2, days) {
        const diffTime = Math.abs(date1.getTime() - date2.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= days;
    }
    isMembershipMatch(membership1, membership2) {
        if (!membership1 || !membership2)
            return false;
        if (this.fuzzyContains(membership1, membership2))
            return true;
        const score = this.jaccard(this.tokenize(membership1), this.tokenize(membership2));
        return score >= 0.5;
    }
    filterAttendanceByDate(attendance, fromDate, toDate) {
        if (!fromDate && !toDate)
            return attendance;
        return attendance.filter(record => {
            const date = this.parseDate(record['Event Starts At'] || record.Date || '');
            if (!date)
                return false;
            if (fromDate) {
                const from = this.parseDate(fromDate);
                if (from && date < from)
                    return false;
            }
            if (toDate) {
                const to = this.parseDate(toDate);
                if (to && date > to)
                    return false;
            }
            return true;
        });
    }
    filterPaymentsByDate(payments, fromDate, toDate) {
        if (!fromDate && !toDate)
            return payments;
        return payments.filter(record => {
            const date = this.parseDate(record.Date);
            if (!date)
                return false;
            if (fromDate) {
                const from = this.parseDate(fromDate);
                if (from && date < from)
                    return false;
            }
            if (toDate) {
                const to = this.parseDate(toDate);
                if (to && date > to)
                    return false;
            }
            return true;
        });
    }
    round2(n) {
        return Math.round((n || 0) * 100) / 100;
    }
    applyDiscountsByInvoice(master, discounts, payments) {
        if (!discounts || discounts.length === 0) {
            console.log(`⚠️ No discounts available to apply`);
            return master;
        }
        console.log(`🔍 Applying discounts to ${master.length} records using memo-based matching`);
        const activeDiscounts = discounts.filter((d) => d && (d.active === true || String(d.active).toLowerCase() === 'true'));
        console.log(`📊 Found ${activeDiscounts.length} active discounts`);
        console.log(`📋 Active discount names:`, activeDiscounts.map(d => d.name));
        const sampleMemos = payments.slice(0, 10).map(p => p.Memo).filter(Boolean);
        console.log(`📋 Sample payment memos:`, sampleMemos);
        const updated = master.map(row => {
            const invoice = String(row.invoiceNumber || '').trim();
            if (!invoice) {
                console.log(`⚠️ No invoice number for ${row.customerName}, skipping discount`);
                return row;
            }
            const paymentRecord = payments.find(p => p.Invoice === invoice);
            if (!paymentRecord) {
                console.log(`⚠️ No payment record found for invoice ${invoice}, skipping discount`);
                return row;
            }
            const memo = String(paymentRecord.Memo || '').trim();
            console.log(`🔍 Checking invoice ${invoice} with memo: "${memo}"`);
            let matchingDiscount = null;
            for (const discount of activeDiscounts) {
                const discountName = String(discount.name || '').trim();
                if (!discountName)
                    continue;
                if (memo === discountName) {
                    matchingDiscount = discount;
                    console.log(`✅ EXACT discount match found for invoice ${invoice}: "${discountName}"`);
                    break;
                }
                if (memo.toLowerCase() === discountName.toLowerCase()) {
                    matchingDiscount = discount;
                    console.log(`✅ CASE-INSENSITIVE discount match found for invoice ${invoice}: "${discountName}"`);
                    break;
                }
                if (memo.toLowerCase().includes(discountName.toLowerCase()) ||
                    discountName.toLowerCase().includes(memo.toLowerCase())) {
                    matchingDiscount = discount;
                    console.log(`✅ PARTIAL discount match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
            }
            if (!matchingDiscount) {
                console.log(`❌ No discount match found for invoice ${invoice} with memo "${memo}"`);
                return row;
            }
            const discountPercentage = Number(matchingDiscount.applicable_percentage || 0);
            const discountFactor = 1 - (discountPercentage / 100);
            const discountedSessionPrice = this.round2(row.sessionPrice * discountFactor);
            console.log(`💰 Applying discount to ${row.customerName}: ${matchingDiscount.name} (${discountPercentage}%)`);
            console.log(`   Session Price: ${row.sessionPrice} → ${discountedSessionPrice}`);
            const amounts = this.calculateAmounts(discountedSessionPrice, null, 'group');
            return {
                ...row,
                discount: matchingDiscount.name,
                discountPercentage: discountPercentage,
                discountedSessionPrice: discountedSessionPrice,
                coachAmount: this.round2(amounts.coach),
                bgmAmount: this.round2(amounts.bgm),
                managementAmount: this.round2(amounts.management),
                mfcAmount: this.round2(amounts.mfc)
            };
        });
        const discountAppliedCount = updated.filter(r => r.discount && r.discountPercentage > 0).length;
        console.log(`✅ Applied discounts to ${discountAppliedCount} records`);
        return updated;
    }
    async applyDiscountsToMasterData(masterData, discounts, payments) {
        console.log(`🔍 Applying discounts to ${masterData.length} master records`);
        if (!discounts || discounts.length === 0) {
            console.log(`⚠️ No discounts available to apply`);
            return masterData;
        }
        const activeDiscounts = discounts.filter((d) => d && (d.active === true || String(d.active).toLowerCase() === 'true'));
        console.log(`📊 Found ${activeDiscounts.length} active discounts`);
        console.log(`📋 Active discount names:`, activeDiscounts.map(d => d.name));
        const sampleMemos = payments.slice(0, 10).map(p => p.Memo).filter(Boolean);
        console.log(`📋 Sample payment memos:`, sampleMemos);
        const updated = masterData.map(row => {
            const invoice = String(row.invoiceNumber || '').trim();
            if (!invoice) {
                console.log(`⚠️ No invoice number for ${row.customerName}, skipping discount`);
                return row;
            }
            const paymentRecord = payments.find(p => p.Invoice === invoice);
            if (!paymentRecord) {
                console.log(`⚠️ No payment record found for invoice ${invoice}, skipping discount`);
                return row;
            }
            const memo = String(paymentRecord.Memo || '').trim();
            console.log(`🔍 Checking invoice ${invoice} with memo: "${memo}"`);
            let matchingDiscount = null;
            for (const discount of activeDiscounts) {
                const discountName = String(discount.name || '').trim();
                if (!discountName)
                    continue;
                if (memo === discountName) {
                    matchingDiscount = discount;
                    console.log(`✅ EXACT discount match found for invoice ${invoice}: "${discountName}"`);
                    break;
                }
                if (memo.toLowerCase() === discountName.toLowerCase()) {
                    matchingDiscount = discount;
                    console.log(`✅ CASE-INSENSITIVE discount match found for invoice ${invoice}: "${discountName}"`);
                    break;
                }
                if (memo.toLowerCase().includes(discountName.toLowerCase()) ||
                    discountName.toLowerCase().includes(memo.toLowerCase())) {
                    matchingDiscount = discount;
                    console.log(`✅ PARTIAL discount match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                const memoWords = memo.toLowerCase().split(/\s+/);
                const discountWords = discountName.toLowerCase().split(/\s+/);
                const significantWords = discountWords.filter(word => word.length > 2 &&
                    !['the', 'and', 'or', 'for', 'with', 'discount', 'pass', 'plan'].includes(word));
                if (significantWords.length > 0 &&
                    significantWords.every(word => memoWords.some(memoWord => memoWord.includes(word) || word.includes(memoWord)))) {
                    matchingDiscount = discount;
                    console.log(`✅ KEYWORD discount match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                if (memo.toLowerCase().includes('loyalty') && discountName.toLowerCase().includes('loyalty')) {
                    matchingDiscount = discount;
                    console.log(`✅ LOYALTY pattern match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                if (memo.toLowerCase().includes('mindbody') && discountName.toLowerCase().includes('mindbody')) {
                    matchingDiscount = discount;
                    console.log(`✅ MINDBODY pattern match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                if (memo.toLowerCase().includes('freedom') && discountName.toLowerCase().includes('freedom')) {
                    matchingDiscount = discount;
                    console.log(`✅ FREEDOM pattern match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                if (memo.toLowerCase().includes('staff') && discountName.toLowerCase().includes('staff')) {
                    matchingDiscount = discount;
                    console.log(`✅ STAFF pattern match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
                if (memo.toLowerCase().includes('boxing') && discountName.toLowerCase().includes('boxing')) {
                    matchingDiscount = discount;
                    console.log(`✅ BOXING pattern match found for invoice ${invoice}: "${discountName}" (memo: "${memo}")`);
                    break;
                }
            }
            if (!matchingDiscount) {
                console.log(`❌ No discount match found for invoice ${invoice} with memo "${memo}"`);
                return row;
            }
            const discountPercentage = Number(matchingDiscount.applicable_percentage || 0);
            console.log(`💰 Adding discount to ${row.customerName}: ${matchingDiscount.name} (${discountPercentage}%)`);
            return {
                ...row,
                discount: matchingDiscount.name,
                discountPercentage: discountPercentage,
                discountedSessionPrice: row.sessionPrice,
                coachAmount: row.coachAmount,
                bgmAmount: row.bgmAmount,
                managementAmount: row.managementAmount,
                mfcAmount: row.mfcAmount
            };
        });
        const discountAppliedCount = updated.filter(r => r.discount && r.discountPercentage > 0).length;
        console.log(`✅ Added discount information to ${discountAppliedCount} records`);
        return updated;
    }
    async recalculateDiscountedAmounts(masterData) {
        console.log(`💰 Recalculating amounts for ${masterData.length} master records`);
        const updated = masterData.map(row => {
            if (!row.discount || row.discountPercentage <= 0) {
                return row;
            }
            const discountPercentage = row.discountPercentage;
            const discountFactor = 1 - (discountPercentage / 100);
            const discountedSessionPrice = this.round2(row.sessionPrice * discountFactor);
            console.log(`💰 Recalculating ${row.customerName}: ${row.discount} (${discountPercentage}%)`);
            console.log(`   Session Price: ${row.sessionPrice} → ${discountedSessionPrice}`);
            const amounts = this.calculateAmounts(discountedSessionPrice, null, 'group');
            return {
                ...row,
                discountedSessionPrice: discountedSessionPrice,
                coachAmount: this.round2(amounts.coach),
                bgmAmount: this.round2(amounts.bgm),
                managementAmount: this.round2(amounts.management),
                mfcAmount: this.round2(amounts.mfc)
            };
        });
        const recalculatedCount = updated.filter(r => r.discount && r.discountPercentage > 0).length;
        console.log(`✅ Recalculated amounts for ${recalculatedCount} discounted records`);
        return updated;
    }
    applyDiscountsFromPayments(master, payments, discounts) {
        if (!discounts || discounts.length === 0 || !payments || payments.length === 0)
            return master;
        const invoiceToDiscount = new Map();
        const activeDiscounts = discounts.filter((d) => d && (d.active === true || String(d.active).toLowerCase() === 'true'));
        for (const p of payments) {
            const memo = String(p.Memo || '');
            const invoice = String(p.Invoice || '').trim();
            if (!invoice || !memo)
                continue;
            for (const d of activeDiscounts) {
                const code = String(d.discount_code || d.name || '').trim();
                if (!code)
                    continue;
                const matchType = String(d.match_type || 'contains').toLowerCase();
                let matched = false;
                if (matchType === 'exact') {
                    matched = this.canonicalize(memo) === this.canonicalize(code);
                }
                else if (matchType === 'regex') {
                    try {
                        matched = new RegExp(code, 'i').test(memo);
                    }
                    catch { }
                }
                else {
                    matched = this.canonicalize(memo).includes(this.canonicalize(code));
                }
                if (matched) {
                    const pct = Number(d.applicable_percentage || 0) || 0;
                    const existing = invoiceToDiscount.get(invoice);
                    if (!existing || pct > existing.pct) {
                        invoiceToDiscount.set(invoice, { name: String(d.name || code), pct });
                    }
                }
            }
        }
        if (invoiceToDiscount.size === 0)
            return master;
        const updated = master.map(r => {
            const inv = String(r.invoiceNumber || '').trim();
            if (!inv)
                return r;
            const found = invoiceToDiscount.get(inv);
            if (!found)
                return r;
            const factor = 1 - (Number(found.pct) || 0) / 100;
            return {
                ...r,
                discount: found.name,
                discountPercentage: found.pct,
                amount: this.round2((r.amount || 0) * factor),
                packagePrice: r.packagePrice,
                sessionPrice: r.sessionPrice,
                discountedSessionPrice: this.round2((r.sessionPrice || 0) * factor),
                coachAmount: this.round2((r.coachAmount || 0) * factor),
                bgmAmount: this.round2((r.bgmAmount || 0) * factor),
                managementAmount: this.round2((r.managementAmount || 0) * factor),
                mfcAmount: this.round2((r.mfcAmount || 0) * factor)
            };
        });
        return updated;
    }
}
exports.AttendanceVerificationService = AttendanceVerificationService;
exports.attendanceVerificationService = new AttendanceVerificationService();
//# sourceMappingURL=attendanceVerificationService.js.map