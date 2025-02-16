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
    
    const gl = get_webgl_context("#gameOfLifeCanvas", "webgl2");
    const canvas = document.querySelector("#gameOfLifeCanvas");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    console.log(`Max texture size ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
    const bytes_per_float = Float32Array.BYTES_PER_ELEMENT;

    /////////////////////////////////
    // Game of Life game state
    /////////////////////////////////
    const pixels_per_square = 16;
    const gol_width = Math.floor(canvas.width / pixels_per_square);
    const gol_height = Math.floor(canvas.height / pixels_per_square);
    const num_cells = gol_width * gol_height;
    const dx = 2.0 / gol_width; // gl screen space
    const dy = 2.0 / gol_height;

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

    const lines_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lines_buffer);
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
    // Main render loop
    /////////////////////////////////

    function render(){
        gl.clear(gl.COLOR_BUFFER_BIT);
        draw_lines();

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
