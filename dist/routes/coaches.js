"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const googleSheets_1 = require("../services/googleSheets");
const router = (0, express_1.Router)();
router.get('/summary', async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const paymentCalcData = await googleSheets_1.googleSheetsService.readSheet('payment_calc_detail');
        if (!paymentCalcData || paymentCalcData.length === 0) {
            return res.json({
                success: true,
                data: [],
                summary: {
                    totalCoaches: 0,
                    totalSessions: 0,
                    totalAmount: 0,
                    totalCoachAmount: 0,
                    totalBgmAmount: 0,
                    totalManagementAmount: 0,
                    totalMfcAmount: 0
                },
                message: 'No payment calculation data found'
            });
        }
        let filteredData = paymentCalcData;
        if (fromDate || toDate) {
            filteredData = paymentCalcData.filter((row) => {
                const rowDate = row.Date || row.date || '';
                if (!rowDate)
                    return false;
                const date = new Date(rowDate);
                if (fromDate && date < new Date(fromDate))
                    return false;
                if (toDate && date > new Date(toDate))
                    return false;
                return true;
            });
        }
        const coachGroups = {};
        filteredData.forEach((row) => {
            // Prefer 'Instructors' (plural) which is the column used in Sheets
            const coach = row.Instructors || row.Instructor || row.instructors || row.instructor || row.Coach || row.coach || 'Unknown';
            if (!coachGroups[coach]) {
                coachGroups[coach] = [];
            }
            coachGroups[coach].push(row);
        });
        const coachesSummary = Object.entries(coachGroups).map(([coachName, sessions]) => {
            const totals = sessions.reduce((acc, session) => {
                acc.totalSessions += 1;
                acc.totalAmount += parseFloat(session.Amount || session.amount || 0) || 0;
                acc.totalCoachAmount += parseFloat(session['Coach Amount'] || session.coachAmount || 0) || 0;
                acc.totalBgmAmount += parseFloat(session['BGM Amount'] || session.bgmAmount || 0) || 0;
                acc.totalManagementAmount += parseFloat(session['Management Amount'] || session.managementAmount || 0) || 0;
                acc.totalMfcAmount += parseFloat(session['MFC Amount'] || session.mfcAmount || 0) || 0;
                return acc;
            }, {
                totalSessions: 0,
                totalAmount: 0,
                totalCoachAmount: 0,
                totalBgmAmount: 0,
                totalManagementAmount: 0,
                totalMfcAmount: 0
            });
            return {
                coachName,
                ...totals,
                averageSessionAmount: totals.totalSessions > 0 ? totals.totalAmount / totals.totalSessions : 0,
                sessions: sessions.length
            };
        });
        coachesSummary.sort((a, b) => b.totalCoachAmount - a.totalCoachAmount);
        const overallSummary = coachesSummary.reduce((acc, coach) => {
            acc.totalCoaches += 1;
            acc.totalSessions += coach.totalSessions;
            acc.totalAmount += coach.totalAmount;
            acc.totalCoachAmount += coach.totalCoachAmount;
            acc.totalBgmAmount += coach.totalBgmAmount;
            acc.totalManagementAmount += coach.totalManagementAmount;
            acc.totalMfcAmount += coach.totalMfcAmount;
            return acc;
        }, {
            totalCoaches: 0,
            totalSessions: 0,
            totalAmount: 0,
            totalCoachAmount: 0,
            totalBgmAmount: 0,
            totalManagementAmount: 0,
            totalMfcAmount: 0
        });
        res.json({
            success: true,
            data: coachesSummary,
            summary: overallSummary,
            message: `Coaches summary retrieved successfully (${coachesSummary.length} coaches)`
        });
    }
    catch (error) {
        console.error('Error fetching coaches summary:', error);
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to retrieve coaches summary',
            data: [],
            summary: {
                totalCoaches: 0,
                totalSessions: 0,
                totalAmount: 0,
                totalCoachAmount: 0,
                totalBgmAmount: 0,
                totalManagementAmount: 0,
                totalMfcAmount: 0
            }
        });
    }
});
router.get('/:coachName/sessions', async (req, res) => {
    try {
        const { coachName } = req.params;
        const { fromDate, toDate } = req.query;
        const paymentCalcData = await googleSheets_1.googleSheetsService.readSheet('payment_calc_detail');
        if (!paymentCalcData || paymentCalcData.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'No payment calculation data found'
            });
        }
        let sessions = paymentCalcData.filter((row) => {
            const rowCoach = row.Instructors || row.Instructor || row.instructors || row.instructor || row.Coach || row.coach || '';
            if (rowCoach !== coachName)
                return false;
            if (fromDate || toDate) {
                const rowDate = row.Date || row.date || '';
                if (!rowDate)
                    return false;
                const date = new Date(rowDate);
                if (fromDate && date < new Date(fromDate))
                    return false;
                if (toDate && date > new Date(toDate))
                    return false;
            }
            return true;
        });
        sessions = sessions.map((session) => ({
            ...session,
            sessionAmount: parseFloat(session.Amount || session.amount || 0) || 0,
            coachAmount: parseFloat(session['Coach Amount'] || session.coachAmount || 0) || 0,
            bgmAmount: parseFloat(session['BGM Amount'] || session.bgmAmount || 0) || 0,
            managementAmount: parseFloat(session['Management Amount'] || session.managementAmount || 0) || 0,
            mfcAmount: parseFloat(session['MFC Amount'] || session.mfcAmount || 0) || 0,
            date: session.Date || session.date || '',
            customer: session.Customer || session.customer || '',
            sessionType: session['Session Type'] || session.sessionType || '',
        }));
        res.json({
            success: true,
            data: sessions,
            count: sessions.length,
            message: `Sessions for ${coachName} retrieved successfully`
        });
    }
    catch (error) {
        console.error(`Error fetching sessions for coach ${req.params.coachName}:`, error);
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to retrieve coach sessions',
            data: []
        });
    }
});
exports.default = router;
//# sourceMappingURL=coaches.js.map