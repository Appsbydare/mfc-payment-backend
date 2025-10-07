import { Router } from 'express';
import { googleSheetsService } from '../services/googleSheets';

const router = Router();

// Get coaches summary data
router.get('/summary', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Read payment calculation details from Google Sheets
    const paymentCalcData = await googleSheetsService.readSheet('payment_calc_detail');

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

    // Filter data by date range if provided
    let filteredData = paymentCalcData;
    if (fromDate || toDate) {
      filteredData = paymentCalcData.filter((row: any) => {
        const rowDate = row.Date || row.date || '';
        if (!rowDate) return false;

        const date = new Date(rowDate);
        if (fromDate && date < new Date(fromDate as string)) return false;
        if (toDate && date > new Date(toDate as string)) return false;
        return true;
      });
    }

    // Group data by coach
    const coachGroups: { [key: string]: any[] } = {};
    filteredData.forEach((row: any) => {
      const coach = row.Instructor || row.instructor || row.Coach || row.coach || 'Unknown';
      if (!coachGroups[coach]) {
        coachGroups[coach] = [];
      }
      coachGroups[coach].push(row);
    });

    // Calculate summary for each coach
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

    // Sort by total coach amount descending
    coachesSummary.sort((a, b) => b.totalCoachAmount - a.totalCoachAmount);

    // Calculate overall summary
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

  } catch (error) {
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

// Get detailed sessions for a specific coach
router.get('/:coachName/sessions', async (req, res) => {
  try {
    const { coachName } = req.params;
    const { fromDate, toDate } = req.query;

    // Read payment calculation details from Google Sheets
    const paymentCalcData = await googleSheetsService.readSheet('payment_calc_detail');

    if (!paymentCalcData || paymentCalcData.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No payment calculation data found'
      });
    }

    // Filter data by coach and date range
    let sessions = paymentCalcData.filter((row: any) => {
      const rowCoach = row.Instructor || row.instructor || row.Coach || row.coach || '';
      if (rowCoach !== coachName) return false;

      if (fromDate || toDate) {
        const rowDate = row.Date || row.date || '';
        if (!rowDate) return false;

        const date = new Date(rowDate);
        if (fromDate && date < new Date(fromDate as string)) return false;
        if (toDate && date > new Date(toDate as string)) return false;
      }
      return true;
    });

    // Add calculated fields and format data
    sessions = sessions.map((session: any) => ({
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

  } catch (error) {
    console.error(`Error fetching sessions for coach ${req.params.coachName}:`, error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve coach sessions',
      data: []
    });
  }
});

export default router;
