// Vercel serverless function — the ONLY way hidden test case content is ever read or
// written. Uses the Supabase service_role key (api/_supabaseAdmin.ts) to bypass RLS,
// which denies anon/authenticated access to public.question_hidden_test_cases entirely.
//
// GET  ?questionIds=id1,id2,...   -> { [questionId]: {input, output}[] }   (teacher editor load)
// POST { questionId, testCases }  -> replaces all hidden test cases for that question
import { supabaseAdmin, isSupabaseAdminConfigured } from './_supabaseAdmin';

export default async function handler(req: any, res: any) {
  if (!isSupabaseAdminConfigured()) {
    res.status(500).json({ error: 'Server is not configured with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' });
    return;
  }
  const supabase = supabaseAdmin!;

  if (req.method === 'GET') {
    const questionIds = String(req.query.questionIds || '').split(',').filter(Boolean);
    if (questionIds.length === 0) {
      res.status(200).json({});
      return;
    }
    const { data, error } = await supabase
      .from('question_hidden_test_cases')
      .select('question_id, input, output')
      .in('question_id', questionIds);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const grouped: Record<string, { input: string; output: string }[]> = {};
    (data || []).forEach((row: any) => {
      if (!grouped[row.question_id]) grouped[row.question_id] = [];
      grouped[row.question_id].push({ input: row.input, output: row.output });
    });
    res.status(200).json(grouped);
    return;
  }

  if (req.method === 'POST') {
    const { questionId, testCases } = (req.body || {}) as {
      questionId?: string;
      testCases?: { input: string; output: string }[];
    };
    if (!questionId) {
      res.status(400).json({ error: 'questionId is required' });
      return;
    }

    // Replace-all: delete existing hidden cases for this question, then insert the new set.
    const { error: deleteError } = await supabase
      .from('question_hidden_test_cases')
      .delete()
      .eq('question_id', questionId);
    if (deleteError) {
      res.status(500).json({ error: deleteError.message });
      return;
    }

    const rows = (testCases || []).map((tc) => ({
      question_id: questionId,
      input: tc.input,
      output: tc.output,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('question_hidden_test_cases').insert(rows);
      if (insertError) {
        res.status(500).json({ error: insertError.message });
        return;
      }
    }

    const { error: countError } = await supabase
      .from('questions')
      .update({ hidden_test_case_count: rows.length })
      .eq('id', questionId);
    if (countError) {
      res.status(500).json({ error: countError.message });
      return;
    }

    res.status(200).json({ success: true, count: rows.length });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
