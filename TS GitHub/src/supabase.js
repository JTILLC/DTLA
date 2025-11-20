import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pvnljuilbrqadnzdzjyh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bmxqdWlsYnJxYWRuemR6anloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4MjQ4MjMsImV4cCI6MjA3NDQwMDgyM30.8qt0dWCnRZ8kUo3-Snrn_FzJHlKZ7azGQ1FsvfrTPKA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;