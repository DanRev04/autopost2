import 'dotenv/config';
import { generatePost } from './src/admin.js';
import { initDatabase } from './src/database.js';

async function validate() {
    console.log('🧐 Validating Post Content...');
    try {
        await initDatabase();
        const post = await generatePost();
        
        console.log('\n--- DATA VERIFICATION ---');
        console.log(`📏 Post Length: ${post.length} characters`);
        
        if (post.length > 4096) {
            console.warn('⚠️ WARNING: Post exceeds Telegram limit of 4096 characters!');
        } else {
            console.log('✅ Length is within limits.');
        }

        // Check for balanced tags
        const tags = post.match(/<[^>]+>/g) || [];
        const stack = [];
        tags.forEach(tag => {
            if (tag.startsWith('</')) {
                const name = tag.slice(2, -1);
                if (stack.length === 0 || stack[stack.length - 1] !== name) {
                    console.error(`❌ HTML Error: Unbalanced closing tag ${tag}`);
                } else {
                    stack.pop();
                }
            } else if (!tag.endsWith('/>')) {
                const name = tag.match(/<([a-z0-9-]+)/i)?.[1];
                if (name && name !== 'br' && name !== 'hr' && name !== 'img') {
                    stack.push(name);
                }
            }
        });

        if (stack.length > 0) {
            console.error(`❌ HTML Error: Unclosed tags: ${stack.join(', ')}`);
        } else {
            console.log('✅ HTML tags seem balanced.');
        }

        console.log('\n--- POST PREVIEW ---');
        console.log(post);

    } catch (error) {
        console.error('❌ Validation crashed:', error.message);
    }
}

validate();
