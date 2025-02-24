(function(){
    /////////////////////////////////
    // WebGL Boilerplate
    /////////////////////////////////
    function get_webgl_context(canvas_name, gl_type){
        const canvas = document.querySelector(canvas_name);
        const gl = canvas.getContext(gl_type);
        if (!gl){
            console.log("Couldn't get webgl context");
        }
        return gl;
    }

    function create_shader(gl, type, source){
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success){
            return shader;
        }

        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    function create_program(gl, vertex_shader, fragment_shader){
        const program = gl.createProgram();
        gl.attachShader(program, vertex_shader);
        gl.attachShader(program, fragment_shader);
        gl.linkProgram(program);
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success){
            return program;
        }

        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    }

    function create_and_link_shaders(gl, vertex_shader_source, fragment_shader_source){
        const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
        const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
        const program = create_program(gl, vertex_shader, fragment_shader);
        return program;
    }

    function create_texture(gl){
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        return texture;
    }
    
    const gl = get_webgl_context("#gameOfLifeCanvas", "webgl2");
    const canvas = document.querySelector("#gameOfLifeCanvas");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    console.log(`Max texture size ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
    console.log(`Max vertices per call ${gl.getParameter(gl.MAX_ELEMENTS_VERTICES)}`);
    const bytes_per_float = Float32Array.BYTES_PER_ELEMENT;

    /////////////////////////////////
    // Game of Life game state
    /////////////////////////////////
    const pixels_per_square = 1;
    const gol_width = Math.floor(canvas.width / pixels_per_square);
    const gol_height = Math.floor(canvas.height / pixels_per_square);
    const num_cells = gol_width * gol_height;
    console.log(`gol_width: ${gol_width} gol_height: ${gol_height} num_cells: ${num_cells}`);

    const x_sections = 8;
    const y_sections = 4;
    const dx = 2.0 / gol_width; // gl screen space
    const dy = 2.0 / gol_height;
    const x_cells_per_section = gol_width / x_sections;
    const y_cells_per_section = gol_height / y_sections;
    const cells_per_section = x_cells_per_section * y_cells_per_section;
    const texture_width = x_cells_per_section;
    const texture_height = y_cells_per_section;
    const tex_dx = 1.0 / x_cells_per_section;
    const tex_dy = 1.0 / y_cells_per_section;
    console.log(`x_cells_per_section: ${x_cells_per_section} y_cells_per_section: ${y_cells_per_section}`);
    console.log(`texture_width: ${texture_width} texture_height: ${texture_height} texture bits: ${texture_width * texture_height * 32}`);

    let generation = 0;

    // the very first 32 bits in the array/texture correspond to
    // the bottom left corners of each section, the next 32 
    // correspond to the bottom row second column, so on and so forth
    // the integer to modify corresponds to the offset within the section
    // the bit to modify depends on the section
    let gol_board = new Uint32Array(num_cells/32).fill(0);
    console.log(`gol_board length: ${gol_board.length} gol_board bits: ${gol_board.length * 32}`)

    const gol_kernel = new Int32Array([
        1, 1, 1,
        1, 9, 1,
        1, 1, 1
    ]);

    /////////////////////////////////
    // Textures and framebuffers
    /////////////////////////////////

    // textures are RGBA8, so layout on GPU is
    // RRRRRRRR GGGGGGGG BBBBBBBB AAAAAAAA
    // index the y sections by channel, RGBA
    // index the x sections by bit
    // e.g. y = 2, x = 4 bit would be accessed by tex.b && (1 << 4)
    // y in [0, 3], x in [0, 7]
    // texture coordinates choose which 32 bit RGBA value to sample
    textures = [];
    framebuffers = [];
    const internal_format = gl.RGBA8;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    for(let i = 0; i < 2; i++){
        const texture = create_texture(gl);
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal_format, texture_width, texture_height, 0, format, type, null);

        const fbo = gl.createFramebuffer(); 
        framebuffers.push(fbo);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE){
            console.log(`framebuffer ${i} incomplete`);
        }
    }

    // x, y are the coordinates of the cell on the board, independent of sectioning
    function set_cell(x, y){
        // in JS array version of board, need to pack bits
        let offset = 0;
        const x_section = Math.floor(x/x_cells_per_section);
        const y_section = Math.floor(y/y_cells_per_section);
        const x_offset = x % x_cells_per_section;
        const y_offset = y % y_cells_per_section;
        const gol_board_index = y_offset * x_cells_per_section + x_offset;
        offset += y_section * 8;
        offset += x_section;

        gol_board[gol_board_index] |= (1 << offset);
    }

    const threshold = 0.5;
    function randomize_board(){
        for(let i = 0; i < num_cells/32; i++){
            for(let j = 0; j < 32; j++){
                const x = Math.random();
                if (x < threshold){
                    gol_board[i] |= 1 << j;
                }
                else{
                    gol_board[i] &= (~(1 << j));
                }
            }
        }
    }

    function buffer_board_to_texture(){
        gl.texImage2D(gl.TEXTURE_2D, 0, internal_format,
                texture_width, texture_height, 0,
                format, type, new Uint8Array(gol_board.buffer)
        );
    }

    // alive 3 cells at (x,y) and (x +/- 1, y)
    function horizontal_triplet(x, y){
        set_cell(x,y);
        set_cell(x-1,y);
        set_cell(x+1,y);
    }

    // initial state: bound texture is textures[1]
    // calling buffer_board_to_texture buffers the board to textures[1]
    // in our first gol step, we'll want to render to framebuffers[0]/textures[0],
    // and afterward, bind textures[0] for the next sample
    randomize_board();
    horizontal_triplet(8, 3);
    horizontal_triplet(61, 29);
    horizontal_triplet(57, 20);

    //gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    buffer_board_to_texture();
    const w = texture_width;
    const h = texture_height;
    const pixel_data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixel_data);
    console.log(pixel_data);

    /////////////////////////////////
    // Draw gridlines
    /////////////////////////////////

    // to draw a straight line, we need a start and an endpoint
    // in 2D, each point needs an x and y
    // for a straight line of constant y spanning the whole
    // screen, the coords are
    // (x_min, y) and (x_max, y)
    // in opengl screenspace, x_max/x_min are +/-1.0
    let gridline_vertices = [];

    // lines of constant x with y = +/- 1.0
    for(let x = -1.0; x < 1.0; x += dx){
        gridline_vertices.push(x);
        gridline_vertices.push(-1.0);
        gridline_vertices.push(x);
        gridline_vertices.push(1.0);
    }

    for(let y = -1.0; y < 1.0; y += dy){
        gridline_vertices.push(-1.0);
        gridline_vertices.push(y);
        gridline_vertices.push(1.0);
        gridline_vertices.push(y);
    }

    const lines_vertex_source = `#version 300 es
        in vec2 a_pos;

        void main(){
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `

    const lines_fragment_source = `#version 300 es
        precision mediump float;
        out vec4 fragColor;

        void main(){
            fragColor = vec4(0.3, 0.4, 0.0, 1.0);
        }
    `

    const lines_program = create_and_link_shaders(gl, lines_vertex_source, lines_fragment_source);
    gl.useProgram(lines_program);
    const lines_position_attribute_location = gl.getAttribLocation(lines_program, "a_pos");

    const lines_vao = gl.createVertexArray();
    gl.bindVertexArray(lines_vao);

    const lines_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lines_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridline_vertices), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(lines_position_attribute_location);
    gl.vertexAttribPointer(lines_position_attribute_location,
        2, gl.FLOAT, false, 2*bytes_per_float, 0
    );

    function draw_lines(){
        gl.useProgram(lines_program);
        gl.bindVertexArray(lines_vao);
        gl.drawArrays(gl.LINES, 0, 2 * (gol_width + gol_height));
    }

    /////////////////////////////////
    // draw cells
    /////////////////////////////////

    // organize vertices from bottom to top, left to right
    // render pixels using indices, order vertices BL, TL, TR, BR
    // pixels in the bottom left quadrants will use the texture's 
    // r channel, bottom right g, top left b, top right alpha
    // divide the board into its 4 quadrants
    // the e.g., bottom left cell in each quadrant will have the same
    // texture coordinates, the "bottom left" of the texture
    let grid_positions_array = new Float32Array(num_cells * 2 * 4);
    let grid_tex_coords_array = new Float32Array(num_cells * 2 * 4);

    for(let y_ind = 0; y_ind < gol_height; y_ind++){
        const screen_y = -1.0 + y_ind * dy;
        const quadrant_y_offset = y_ind % y_cells_per_section;
        const tex_y = quadrant_y_offset * tex_dy;
        let i = y_ind * gol_width * 8;

        for(let x_ind = 0; x_ind < gol_width; x_ind++){
            const screen_x = -1.0 + x_ind * dx;
            const quadrant_x_offset = x_ind % x_cells_per_section;
            const tex_x = quadrant_x_offset * tex_dx;

            // bottom left
            // positions
            grid_positions_array[i] = screen_x;
            grid_positions_array[i + 1] = screen_y;
            grid_tex_coords_array[i] = tex_x;
            grid_tex_coords_array[i + 1] = tex_y;

            // top le;
            grid_positions_array[i + 2] = screen_x;
            grid_positions_array[i + 3] = screen_y + dy;
            grid_tex_coords_array[i + 2] = tex_x;
            grid_tex_coords_array[i + 3] = tex_y + tex_dy;

            // top right
            grid_positions_array[i + 4] = screen_x + dx;
            grid_positions_array[i + 5] = screen_y + dy;
            grid_tex_coords_array[i + 4] = tex_x + tex_dx;
            grid_tex_coords_array[i + 5] = tex_y + tex_dy;

            // bottom right
            grid_positions_array[i + 6] = screen_x + dx;
            grid_positions_array[i + 7] = screen_y;
            grid_tex_coords_array[i + 6] = tex_x + tex_dx;
            grid_tex_coords_array[i + 7] = tex_y;

            i += 8;
        }
    }

    let grid_indices = new Uint32Array(num_cells * 6);
    for(let i = 0; i < num_cells; i++){
        grid_indices[6 * i + 0] = 4 * i + 0;
        grid_indices[6 * i + 1] = 4 * i + 1;
        grid_indices[6 * i + 2] = 4 * i + 2;
        grid_indices[6 * i + 3] = 4 * i + 0;
        grid_indices[6 * i + 4] = 4 * i + 2;
        grid_indices[6 * i + 5] = 4 * i + 3;
    }

    // both the grid rendering and the gol steps use their texture coordinates to sample the texture
    // the texture coordinates determine what cell within the section is sampled
    // the bit/channel within that texture sample determines which x/y section is sampled
    //
    // which bits/locations on the screen are written to is determined by the gl_Position set
    // in the vertex shaders, which is different in the gol step and rendering to the screen
    //
    // 
    const texture_extraction_functions = `
        uniform ivec3 u_grid_resolution;
        uniform ivec2 u_sections;
        uniform sampler2D u_board;
        in vec2 tex_coords;

        // pass pos, the coordinate of the gol cell
        // return x/y of section that gol cell falls in 
        ivec2 get_section_coord(ivec2 pos){
            ivec2 cell_pos = pos / u_grid_resolution.z;
            ivec2 cells_per_section = u_grid_resolution.xy / u_sections;
            return cell_pos / cells_per_section;
        }

        // to extract a bit from a texture, need to know what tex coords to sample
        // and what bits to extract
        // we'll always be centered on *this* cell, so the call to texture can be
        // handled just with a texel offset
        // the texture coords determine the cell within the section, and we'll always
        // want to get neighbors to this one
        // before sampling the texture, we need to know what cell within a section
        // we access
        // because an offset could move over the borders of a subsection, compute
        // which section the cell falls in after addition of the offset
        // to compute which section after offset, need to know where within a section
        // this cell is
        // in 
        //
        // pass in x,y of section for extracting bit from channel
        // pass in offset for texture sampling
        // return 1/0 in corresponding bit in texture
        int extract_bit_from_texture(ivec2 section, ivec2 offset){
            vec2 one_texel = vec2(1.0) / vec2(textureSize(u_board, 0));
            vec2 sample_coords = tex_coords + one_texel * vec2(offset);

            bvec2 inc_mask = greaterThan(sample_coords, vec2(1.0));
            bvec2 dec_mask = lessThan(sample_coords, vec2(0.0));
            section += ivec2(inc_mask);
            section -= ivec2(dec_mask);

            vec4 board_sample = texture(u_board, sample_coords);

            int red_bits = int(board_sample.r * 255.0);
            int green_bits = int(board_sample.g * 255.0);
            int blue_bits = int(board_sample.b * 255.0);
            int alpha_bits = int(board_sample.a * 255.0);

            int bits;
            if(section.y == 0) bits = red_bits;
            else if(section.y == 1) bits = green_bits;
            else if(section.y == 2) bits = blue_bits;
            else bits = alpha_bits;

            return (bits >> section.x) & 1;
        }
    `

    const grid_vertex_source = `#version 300 es
        in vec2 a_pos;
        in vec2 a_tex_coords;
        out vec2 tex_coords;

        void main(){
            gl_Position = vec4(a_pos.x, a_pos.y, 0.0, 1.0);
            tex_coords = a_tex_coords;
        }
    `

    const grid_fragment_source = `#version 300 es
        precision mediump float;
        out vec4 fragColor;

        ${texture_extraction_functions}

        void main(){

            ivec2 this_section_coord = get_section_coord(ivec2(gl_FragCoord.xy));
            float dye_strength = 0.25;
            vec4 dye_color = ((this_section_coord.x + this_section_coord.y) & 1) == 1
                            ? dye_strength * vec4(1.0, 1.0, 0.0, 1.0)
                            : dye_strength * vec4(0.0, 1.0, 1.0, 1.0);

            // alive cells are white
            vec4 alive_color = vec4(1.0);
            vec4 dead_color = vec4(vec3(0.0), 1.0);

            ivec2 idxs = get_section_coord(ivec2(gl_FragCoord.xy));
            int this_bit = extract_bit_from_texture(idxs, ivec2(0));
            vec4 cell_color = this_bit == 1 ? alive_color : dead_color;
            fragColor = cell_color + dye_color;
        }
    `

    const grid_program = create_and_link_shaders(gl, grid_vertex_source, grid_fragment_source);
    gl.useProgram(grid_program);
    const grid_position_attribute_location = gl.getAttribLocation(grid_program, "a_pos");
    const grid_tex_coords_attribute_location = gl.getAttribLocation(grid_program, "a_tex_coords");
    const grid_resolution_location = gl.getUniformLocation(grid_program, "u_grid_resolution");
    const grid_sections_location = gl.getUniformLocation(grid_program, "u_sections");

    gl.uniform3iv(grid_resolution_location, [gol_width, gol_height, pixels_per_square]);
    gl.uniform2iv(grid_sections_location, [x_sections, y_sections]);

    const grid_vao = gl.createVertexArray();
    gl.bindVertexArray(grid_vao);

    const buffer_size = grid_positions_array.byteLength + grid_tex_coords_array.byteLength;
    const grid_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, grid_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer_size, gl.STATIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, grid_positions_array);
    gl.bufferSubData(gl.ARRAY_BUFFER, grid_positions_array.byteLength, grid_tex_coords_array);

    const grid_ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid_ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid_indices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(grid_position_attribute_location);
    gl.vertexAttribPointer(grid_position_attribute_location,
        2, gl.FLOAT, false, 2 * bytes_per_float, 0
    );

    gl.enableVertexAttribArray(grid_tex_coords_attribute_location);
    gl.vertexAttribPointer(grid_tex_coords_attribute_location,
        2, gl.FLOAT, false, 2 * bytes_per_float, grid_positions_array.byteLength 
    );


    function draw_grid(){
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(grid_program);
        gl.bindVertexArray(grid_vao);
        gl.drawElements(gl.TRIANGLES, 6 * num_cells, gl.UNSIGNED_INT, 0);
    }

    /////////////////////////////////
    // game of life simulation
    /////////////////////////////////

    let gol_coords = new Float32Array(4 * cells_per_section);
    for(let i = 0, y = 0; y < y_cells_per_section; y++){
        for(let x = 0; x < x_cells_per_section; x++, i += 4){
            gol_coords[i + 0] = -1.0 + x * 2 * tex_dx + tex_dx;
            gol_coords[i + 1] = -1.0 + y * 2 * tex_dy + tex_dy;
            gol_coords[i + 2] = x * tex_dx + 0.5 * tex_dx;
            gol_coords[i + 3] = y * tex_dy + 0.5 * tex_dy;
        }
    }

    const gol_vertex_source = `#version 300 es
        in vec4 coords;
        out vec2 tex_coords;

        void main(){
            gl_Position = vec4(coords.xy, 0.0, 1.0);
            gl_PointSize = 1.0;
            tex_coords = coords.zw;
        }
    `

    // the gol step needs to iterate through each cell, which 
    // is handled by the texture coords per shader run
    // each shader run needs to update the 32 vertices in each bit 
    // iterate through the 32 cells this tex_coords is responsible for,
    // check each of their 8 neighbors, and accumulate in sum
    // the extraction functions will handle the offsets and properly indexing
    // the right texture coordinates 
    const gol_fragment_source = `#version 300 es
        precision mediump float;
        uniform int u_kernel[9];
        out vec4 fragColor;
        
        ${texture_extraction_functions}

        void main(){

            fragColor = vec4(0);
            int sample_int = 0;

            // j indexes which bit to set
            // j % 8 indicates which bit within a channel, what x section
            // j / 8 indicates which channel, which y section
            for(int j = 0; j < 32; j++){
                int x = j % 8;
                int y = (j / 8) % 4;
                int sum = 0;
                for(int i = 0; i < 9; i++){
                    int texel_dx = -1 + i % 3;
                    int texel_dy = -1 + i / 3;
                    sum += u_kernel[i] * extract_bit_from_texture(ivec2(x, y), ivec2(texel_dx, texel_dy));
                }
                sample_int |= (((sum == 3 || sum == 11 || sum == 12) ? 1 : 0) << j);
            }

            fragColor.r = float((sample_int >> 0) & 0xFF) / 255.0;
            fragColor.g = float((sample_int >> 8) & 0xFF) / 255.0;
            fragColor.b = float((sample_int >> 16) & 0xFF) / 255.0;
            fragColor.a = float((sample_int >> 24) & 0xFF) / 255.0;
        }
    `
    
    const gol_program = create_and_link_shaders(gl, gol_vertex_source, gol_fragment_source);
    gl.useProgram(gol_program);
    const gol_coords_location = gl.getAttribLocation(gol_program, "coords");
    const gol_kernel_location = gl.getUniformLocation(gol_program, "u_kernel");
    const gol_grid_resolution_location = gl.getUniformLocation(gol_program, "u_grid_resolution");
    const gol_sections_location = gl.getUniformLocation(gol_program, "u_sections");

    gl.uniform3iv(gol_grid_resolution_location, [texture_width, texture_height, 1]);
    gl.uniform2iv(gol_sections_location, [texture_width, texture_height]);

    const gol_vao = gl.createVertexArray();
    gl.bindVertexArray(gol_vao);

    const gol_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gol_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, gol_coords, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(gol_coords_location);
    gl.vertexAttribPointer(gol_coords_location,
        4, gl.FLOAT, false, 0, 0
    );

    function gol_step(kernel){
        gl.useProgram(gol_program);
        gl.viewport(0, 0, 1, 1);
        gl.viewport(0, 0, texture_width, texture_height);
        gl.bindVertexArray(gol_vao);
        gl.uniform1iv(gol_kernel_location, kernel);
        gl.drawArrays(gl.POINTS, 0, cells_per_section);
    }

    /////////////////////////////////
    // Main render loop
    /////////////////////////////////
    
    draw_grid();
    draw_lines();

    let prev_time = Date.now();
    const interval = 1000/10;
    let elapsed_time = 0;
    function render(){
        const current_time = Date.now();
        const dt = current_time - prev_time;
        prev_time = current_time;
        elapsed_time += dt;

        if(elapsed_time > interval){
            elapsed_time -= interval;

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[generation % 2]);
            gol_step(gol_kernel);

            if(generation < 3){
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixel_data);
                console.log(pixel_data);
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            //gol_step(gol_kernel);
            gl.bindTexture(gl.TEXTURE_2D, textures[generation % 2]);

            draw_grid();
            //draw_lines();
            generation++;
        }

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
